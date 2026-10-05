import { NextResponse, type NextRequest } from "next/server";

import { acceptInvite, markInviteAccepted } from "@/lib/admin/invites";
import { createClient } from "@/lib/supabase/server";
import { reportError, reportWarning } from "@/lib/observability";

/**
 * `POST /invite/[token]/accept` — the invite page's button.
 *
 * Checks the invite, has Supabase mint a one-off sign-in for the account and
 * verifies it on this browser's own session, so they're signed in exactly as
 * an email link would sign them in (the password step relies on that). Then
 * the invite is spent, and they choose a password.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/invite/[token]/accept">) {
  const { token } = await ctx.params;
  const base = baseUrl(request);

  const accepted = await acceptInvite(token);
  // The page explains whatever went wrong — used, expired or replaced.
  if (!accepted.ok) return NextResponse.redirect(`${base}/invite/${token}`, 303);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: accepted.tokenHash });
  if (error) {
    reportWarning("[invites] Sign-in from invite failed:", error);
    return NextResponse.redirect(`${base}/auth/auth-code-error`, 303);
  }

  await markInviteAccepted(accepted.userId).catch((failure) =>
    reportError("[invites] Couldn't mark the invite accepted", failure, { extra: { userId: accepted.userId } })
  );
  return NextResponse.redirect(`${base}/join`, 303);
}

/** Behind a load balancer `origin` is the internal address — as in the OAuth callback. */
function baseUrl(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (process.env.NODE_ENV === "development" || !forwardedHost) return request.nextUrl.origin;
  return `https://${forwardedHost}`;
}
