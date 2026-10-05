import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { memberships, organizations, profiles } from "@/lib/db/schema";
import { identify } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

/**
 * The Data Access Layer is the authorization boundary for this app.
 *
 * Drizzle connects as the `postgres` role, which bypasses RLS - so "the
 * database will stop it" is not true here. Every query that touches tenant data
 * must go through a function in this file, or otherwise be scoped by an
 * organization id that was verified against a membership row.
 *
 * `cache()` memoizes per render pass, so a layout, page and three components
 * calling `getCurrentUser()` produce one auth check and one query, not five.
 */

/**
 * Authoritative session check - hits the Supabase Auth server rather than
 * trusting the cookie. Use this, not the optimistic check in proxy.ts.
 */
export const verifySession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  identify(user.id);
  return { userId: user.id, email: user.email ?? "" };
});

/** Same as `verifySession` but redirects instead of returning null. */
export const requireSession = cache(async () => {
  const session = await verifySession();
  if (!session) redirect("/login");
  return session;
});

/**
 * How long an email link counts as proof of who is holding the session.
 *
 * Setting a password normally takes the current one. A reset link cannot ask
 * for it — the contractor forgot it — so the link is the proof: only someone
 * who can open that inbox could have produced this session. Supabase records
 * the sign-in method and its time in the token's `amr` claim, and that
 * timestamp survives refreshes, so the window is real rather than resetting
 * every hour. Thirty minutes covers a phone call in the middle of a reset
 * without leaving a borrowed laptop able to change the password all afternoon.
 */
export const EMAIL_LINK_PROOF_MINUTES = 30;

/**
 * Whether this session signed in through an email link inside that window.
 *
 * `getClaims` verifies the token's signature rather than trusting a decode.
 * API routes pass the caller's access token; pages omit it and the cookie
 * session is used.
 */
export async function signedInByEmailLinkRecently(accessToken?: string) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims(accessToken);
  const amr = data?.claims.amr ?? [];
  const cutoff = Date.now() / 1000 - EMAIL_LINK_PROOF_MINUTES * 60;

  // A verified recovery link records `otp` (checked against a live project,
  // not assumed); the PKCE variant of the same link may record `recovery`.
  // This app offers neither for everyday sign-in, so both mean the session
  // came in from the inbox.
  // auth-js types `amr` as entries or bare strings; only entries carry a time.
  return amr.some(
    (entry) =>
      typeof entry === "object" &&
      // An invite signs in with a one-off magic link, which may record either
      // of its own names too.
      ["otp", "recovery", "magiclink", "invite"].includes(entry.method) &&
      entry.timestamp >= cutoff
  );
}

export const getCurrentUser = cache(async () => {
  const session = await verifySession();
  if (!session) return null;

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, session.userId))
    .limit(1);

  return profile ?? null;
});

/**
 * How this person can sign in — what `/account` shows.
 *
 * **Read from Supabase rather than mirrored into `profiles`.** A mirrored list
 * of providers is a list that is wrong the moment somebody links or unlinks
 * one, and being wrong here means telling a contractor they can get back in a
 * way they cannot.
 *
 * `email` is a provider like any other in Supabase's model: its presence is
 * what says there is a password on the account, and its absence is why a
 * Google-only contractor is offered a reset link rather than a change form.
 */
export type SignInMethod = {
  provider: string;
  /** The address or handle the provider knows them by. */
  identifier: string | null;
  linkedAt: string | null;
  lastUsedAt: string | null;
};

export const getSignInMethods = cache(async (): Promise<SignInMethod[]> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  return (user.identities ?? []).map((identity) => ({
    provider: identity.provider,
    identifier:
      (identity.identity_data?.email as string | undefined) ??
      (identity.identity_data?.name as string | undefined) ??
      null,
    linkedAt: identity.created_at ?? null,
    lastUsedAt: identity.last_sign_in_at ?? null,
  }));
});

/** Every organization the signed-in user belongs to, with their role. */
export const getUserOrganizations = cache(async () => {
  const session = await verifySession();
  if (!session) return [];

  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.userId, session.userId));
});

/**
 * Resolves the organization a request is acting on.
 *
 * MVP behaviour: a user's first (usually only) organization. When org switching
 * lands, read the active org from a cookie here and validate it against
 * membership - the callers do not change.
 */
export const getActiveOrganization = cache(async () => {
  const orgs = await getUserOrganizations();
  return orgs[0] ?? null;
});

export const requireActiveOrganization = cache(async () => {
  const org = await getActiveOrganization();
  if (!org) redirect("/welcome");
  return org;
});

/**
 * Verifies the signed-in user is a member of `organizationId`, and optionally
 * that they hold one of `allowedRoles`. Returns the membership or null.
 *
 * Call this before any query that takes an organization id from user input -
 * a route param, form field or query string.
 */
export const requireMembership = cache(
  async (
    organizationId: string,
    allowedRoles?: ReadonlyArray<(typeof memberships.role.enumValues)[number]>
  ) => {
    const session = await verifySession();
    if (!session) return null;

    const [membership] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, session.userId)
        )
      )
      .limit(1);

    if (!membership) return null;
    if (allowedRoles && !allowedRoles.includes(membership.role)) return null;

    return membership;
  }
);

/** Roles permitted to manage billing and org settings. */
export const BILLING_ROLES = ["owner", "admin"] as const;
