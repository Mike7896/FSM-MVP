import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / PKCE callback. Exchanges the `code` query parameter for a session
 * and sets the auth cookies, then sends the user on.
 *
 * Three ways this is reached, and they are not the same failure:
 * - **Success** — `?code=...`, which we exchange for a session.
 * - **The user declined at Google** — `?error=access_denied`. Not an error to
 *   apologise for; they pressed cancel, so send them back to sign in.
 * - **Something genuinely broke** — a bad or reused code, or a missing PKCE
 *   verifier cookie.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const providerError = searchParams.get("error");
  const providerErrorDescription = searchParams.get("error_description");

  const next = safeNextPath(searchParams.get("next"));

  // The provider refused or the user cancelled before any code was issued.
  if (providerError) {
    console.error(
      `[auth] Provider returned "${providerError}": ${providerErrorDescription ?? "no description"}`
    );
    const reason =
      providerError === "access_denied" ? "cancelled" : "provider-error";
    return NextResponse.redirect(
      `${origin}/auth/auth-code-error?reason=${reason}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/auth/auth-code-error?reason=no-code`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // The usual cause is a missing PKCE verifier cookie, which happens when the
    // flow was started somewhere that could not write one — see the note in
    // `app/auth/google/route.ts`.
    console.error("[auth] Code exchange failed:", error.message);
    return NextResponse.redirect(
      `${origin}/auth/auth-code-error?reason=exchange-failed`
    );
  }

  // `x-forwarded-host` is set by the load balancer in production; behind one,
  // `origin` is the internal address and would redirect to the wrong host.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocal = process.env.NODE_ENV === "development";
  const base = isLocal || !forwardedHost ? origin : `https://${forwardedHost}`;

  return NextResponse.redirect(`${base}${next}`);
}
