import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { reportWarning } from "@/lib/observability";

/**
 * Email link confirmation — signup verification, email change and password
 * recovery all land here.
 *
 * **Two link shapes, both accepted.** An email template built from
 * `{{ .TokenHash }}` arrives with `token_hash` and `type`, and works on any
 * device. Supabase's default template arrives with a PKCE `code` instead, which
 * only completes in the browser that asked for the email, because the verifier
 * cookie lives there. Handling both means the flow works before anyone edits
 * the template, and works everywhere after.
 *
 * **A failed reset link goes back to Forgot password, not to a dead end.** The
 * contractor is locked out, and the useful next step is a new link.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  const recovering = type === "recovery" || next === "/reset-password";

  const failed = (reason: "expired" | "other-browser") =>
    NextResponse.redirect(
      recovering
        ? `${origin}/forgot-password?reason=${reason}`
        : `${origin}/auth/auth-code-error${
            reason === "other-browser" ? "?reason=exchange-failed" : ""
          }`
    );

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) {
      reportWarning("[auth] OTP verification failed:", error);
      return failed("expired");
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Nearly always a missing verifier: the link was opened in a different
      // browser from the one that asked for it.
      reportWarning("[auth] Code exchange failed:", error);
      return failed("other-browser");
    }
  } else {
    // Supabase sends an expired or already-used link here with the error in
    // the URL fragment, which never reaches a server — so no parameters at
    // all means exactly that.
    return failed("expired");
  }

  return NextResponse.redirect(`${origin}${next}`);
}
