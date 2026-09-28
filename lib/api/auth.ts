import "server-only";

import { and, eq } from "drizzle-orm";
import type { Session } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { memberships, organizations } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { ApiError } from "./response";

/**
 * Who is calling, and on whose behalf.
 *
 * **Two credentials, one code path.** The web app sends the Supabase session
 * cookie; the native app and Postman send `Authorization: Bearer <access
 * token>`. Supporting both is what makes these routes a real API rather than an
 * internal fetch target — and the bearer path is the one that matters, because
 * a native client manages its own token storage and has no cookie jar.
 *
 * The bearer token is verified against the Auth server rather than merely
 * decoded. A JWT this route trusts without checking is a JWT anyone can forge.
 */
export type ApiCaller = {
  userId: string;
  email: string;
  /** How the request authenticated — useful in logs when something misbehaves. */
  via: "bearer" | "cookie";
};

export async function requireCaller(request: NextRequest): Promise<ApiCaller> {
  const bearer = bearerToken(request);

  const supabase = await createClient();

  const { data, error } = bearer
    ? await supabase.auth.getUser(bearer)
    : await supabase.auth.getUser();

  if (error || !data.user) {
    throw new ApiError(
      "unauthenticated",
      bearer
        ? "That access token isn't valid or has expired."
        : "Sign in, or send an Authorization: Bearer <access token> header."
    );
  }

  return {
    userId: data.user.id,
    email: data.user.email ?? "",
    via: bearer ? "bearer" : "cookie",
  };
}

/** The token from an `Authorization: Bearer` header, if one was sent. */
export function bearerToken(request: NextRequest): string | undefined {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

/**
 * The caller plus the access token they authenticated with.
 *
 * Only for the auth routes that act on the session itself — signing out,
 * setting a password. It is deliberately not a field on `ApiCaller`: a token
 * that rides along into domain code is a token that one day gets logged.
 */
export async function requireSessionToken(
  request: NextRequest
): Promise<{ caller: ApiCaller; accessToken: string }> {
  const caller = await requireCaller(request);

  const bearer = bearerToken(request);
  if (bearer) return { caller, accessToken: bearer };

  // `requireCaller` has already verified this session against the Auth
  // server, so reading the token out of the cookie trusts nothing new.
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw new ApiError("unauthenticated", "Your session ended. Sign in again.");
  }

  return { caller, accessToken: data.session.access_token };
}

/**
 * Refuses a browser request that came from another site.
 *
 * **Server Functions did this for free; route handlers do not.** The auth
 * routes set session cookies, so without this any page on the internet could
 * post a form here and sign a visitor into an account of the attacker's
 * choosing — login CSRF. Native clients and Postman send no `Origin` at all,
 * which is why a missing header passes: only a browser sends one, and only a
 * browser can be tricked into sending a request.
 */
export function requireSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // `Origin: null` — sandboxed frames and opaque redirects. Not this site.
  }

  if (!host || originHost !== host) {
    throw new ApiError(
      "forbidden",
      "That request didn't come from this site."
    );
  }
}

/**
 * Turns a Supabase Auth failure into the API's error shape.
 *
 * Branches on Supabase's `code` rather than its prose, and rewrites the ones a
 * contractor actually meets — "Invalid login credentials" names the failure
 * without saying what to do about it. A 4xx it does not recognise keeps
 * Supabase's own message, which beats inventing one.
 */
export function authFailure(error: {
  code?: string;
  status?: number;
  message: string;
}): ApiError {
  switch (error.code) {
    case "invalid_credentials":
      return new ApiError(
        "unauthenticated",
        "That email and password don't match. Check both, or reset your password."
      );
    case "email_not_confirmed":
      return new ApiError(
        "forbidden",
        "Confirm your email first — the link is in your inbox."
      );
    case "user_already_exists":
    case "email_exists":
      return new ApiError(
        "conflict",
        "There's already an account with that email. Sign in instead."
      );
    case "same_password":
      return new ApiError(
        "invalid_request",
        "That's the password you already have. Pick a new one.",
        [{ field: "password", message: "That's the password you already have." }]
      );
    case "weak_password":
      return new ApiError("invalid_request", error.message, [
        { field: "password", message: error.message },
      ]);
    case "signup_disabled":
    case "email_provider_disabled":
      return new ApiError(
        "forbidden",
        "Email sign-in is turned off. Continue with Google instead."
      );
    case "user_banned":
      return new ApiError(
        "forbidden",
        "This account is suspended. If you think that's a mistake, write to us from the Support page."
      );
    case "over_email_send_rate_limit":
      return new ApiError(
        "rate_limited",
        "Too many emails have gone out recently. Wait a little while, then try again."
      );
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found":
      return new ApiError(
        "unauthenticated",
        "Your session ended. Sign in again."
      );
  }

  if (error.status === 429) return new ApiError("rate_limited", error.message);
  if (error.status && error.status < 500) {
    return new ApiError("invalid_request", error.message);
  }

  // A 5xx is not the caller's to fix. Throwing a plain Error lets `handler`
  // log it and answer with its flat 500.
  throw new Error(`Supabase Auth ${error.status ?? "error"}: ${error.message}`);
}

/**
 * A session as the API hands it to a client that keeps its own tokens. One
 * shape for sign-in and sign-up, so a native client parses one thing.
 */
export function sessionBody(session: Session) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
  };
}

export type CallerOrg = {
  organizationId: string;
  role: (typeof memberships.role.enumValues)[number];
};

/**
 * Resolves which organization this request acts on, and proves the caller
 * belongs to it.
 *
 * This is the API's half of the rule the DAL enforces for pages: **Drizzle
 * connects as a role that bypasses RLS**, so an organization id arriving from a
 * client is an assertion, not a fact, until it has been checked against a
 * membership row. Every domain route goes through here before touching data.
 *
 * Resolution order:
 * 1. `X-Organization-Id` header, if present — explicit wins, and it is how a
 *    multi-org contractor picks.
 * 2. The caller's only membership, when they have exactly one. Most
 *    owner-operators never send the header.
 * 3. Otherwise refuse and say so, rather than guessing which shop's money the
 *    request meant.
 */
export async function requireOrg(
  request: NextRequest,
  caller: ApiCaller,
  options?: {
    roles?: ReadonlyArray<(typeof memberships.role.enumValues)[number]>;
    /**
     * Explicit override, for endpoints that take the organization in the body
     * rather than the header. Beats the header when both are present.
     */
    organizationId?: string;
  }
): Promise<CallerOrg> {
  const allowedRoles = options?.roles;
  const requested =
    options?.organizationId ?? request.headers.get("x-organization-id");

  const rows = await db
    .select({
      organizationId: memberships.organizationId,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(
      requested
        ? and(
            eq(memberships.userId, caller.userId),
            eq(memberships.organizationId, requested)
          )
        : eq(memberships.userId, caller.userId)
    );

  if (requested && rows.length === 0) {
    // Deliberately "forbidden" rather than "not found": the caller asked about
    // a specific organization and is not in it.
    throw new ApiError(
      "forbidden",
      "You're not a member of that organization."
    );
  }

  if (rows.length === 0) {
    throw new ApiError(
      "forbidden",
      "This account isn't a member of any organization yet. Create one first."
    );
  }

  if (!requested && rows.length > 1) {
    throw new ApiError(
      "invalid_request",
      "You belong to more than one organization — send an X-Organization-Id header to say which.",
      { organizations: rows.map((r) => r.organizationId) }
    );
  }

  const match = rows[0];

  if (allowedRoles && !allowedRoles.includes(match.role)) {
    throw new ApiError(
      "forbidden",
      `This needs one of: ${allowedRoles.join(", ")}. You are ${match.role}.`
    );
  }

  return match;
}
