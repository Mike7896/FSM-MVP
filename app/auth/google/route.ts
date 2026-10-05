import { NextResponse, type NextRequest } from "next/server";

import { requireSameOrigin } from "@/lib/api/auth";
import { absoluteUrl } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability";

/**
 * `POST /auth/google` — start Google sign-in.
 *
 * **A redirect, not an API call**, which is why it sits beside `/auth/callback`
 * rather than under `/api/v1`. OAuth ends at Google's consent screen in the
 * contractor's browser; the sign-in page posts a plain form here, so it works
 * before the page has hydrated. A native app signs in with Google's own SDK and
 * never comes this way.
 *
 * `signInWithOAuth` mints a PKCE verifier and must store it before the browser
 * leaves for Google. Running server-side writes it as a cookie on this
 * response, which is what lets `/auth/callback` finish
 * `exchangeCodeForSession()` on the way back. Start the flow in the browser
 * and the verifier lands somewhere the callback cannot read it.
 *
 * Every failure ends on a page a person can read, never in JSON.
 */
export async function POST(request: NextRequest) {
  const fail = () =>
    NextResponse.redirect(
      absoluteUrl("/auth/auth-code-error?reason=oauth-start"),
      303
    );

  try {
    requireSameOrigin(request);
  } catch {
    return fail();
  }

  const form = await request.formData().catch(() => null);
  const next = safeNextPath(form?.get("next"));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      // Must be listed in Supabase → Authentication → URL Configuration.
      redirectTo: absoluteUrl(
        `/auth/callback?next=${encodeURIComponent(next)}`
      ),
      queryParams: {
        access_type: "offline",
        prompt: "consent select_account",
      },
    },
  });

  if (error || !data.url) {
    reportError("[auth] Could not start Google sign-in:", error ?? undefined);
    return fail();
  }

  // 303, so the browser follows with a GET. A 307 would re-post the form.
  return NextResponse.redirect(data.url, 303);
}
