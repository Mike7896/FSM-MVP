import { createClient as createStatelessClient } from "@supabase/supabase-js";

import {
  authFailure,
  requireSameOrigin,
  requireSessionToken,
} from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, noContent } from "@/lib/api/response";
import { signedInByEmailLinkRecently } from "@/lib/dal";
import { clientEnv } from "@/lib/env";
import { setPasswordSchema } from "@/lib/schemas";

/**
 * `PUT /api/v1/auth/password` — change a password, or set one from a reset
 * link.
 *
 * **Supabase will change a password on the strength of a session alone, so
 * this route demands proof first**, and accepts exactly two kinds:
 *
 * 1. **The current password** — the Account form. An unlocked laptop is not a
 *    taken account.
 * 2. **A session that came in through an email link within
 *    `EMAIL_LINK_PROOF_MINUTES`** — the reset flow. The contractor forgot the
 *    password, so opening the inbox is the proof instead.
 *
 * A perfectly good session that arrived neither way is refused.
 *
 * On success Supabase keeps the session that made the change and ends every
 * other one (checked against the live project, not assumed). Whoever else was
 * signed in with the old password is out; this device stays in.
 */
export const PUT = handler(async (request) => {
  requireSameOrigin(request);
  const { caller, accessToken } = await requireSessionToken(request);
  const body = await readJson(request, setPasswordSchema);

  if (body.currentPassword !== undefined) {
    if (!(await passwordIsCorrect(caller.email, body.currentPassword))) {
      throw new ApiError(
        "invalid_request",
        "That current password isn't right.",
        [{ field: "currentPassword", message: "That current password isn't right." }]
      );
    }
  } else if (!(await signedInByEmailLinkRecently(accessToken))) {
    throw new ApiError(
      "forbidden",
      "Enter your current password. If you've forgotten it, request a reset link and set a new one from there."
    );
  }

  // The same request `supabase.auth.updateUser` makes, addressed with the
  // caller's own token. The SDK method can only read a token out of a cookie
  // session and a native caller has none — this way both clients get
  // Supabase's rules identically.
  const response = await fetch(
    `${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`,
    {
      method: "PUT",
      headers: {
        apikey: clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: body.password }),
    }
  );

  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as {
      error_code?: string;
      msg?: string;
    } | null;
    throw authFailure({
      code: failure?.error_code,
      status: response.status,
      message: failure?.msg ?? "The new password wasn't accepted.",
    });
  }

  return noContent();
});

/**
 * Re-authenticates without touching the caller's session.
 *
 * A throwaway client that persists nothing: signing in on the request's own
 * cookie client would swap the caller's session for a new one, and for a
 * native caller would mint a session nobody ever uses. The proof session is
 * ended as soon as it has answered.
 */
async function passwordIsCorrect(email: string, password: string) {
  const probe = createStatelessClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  const { error } = await probe.auth.signInWithPassword({ email, password });

  if (error?.code === "invalid_credentials") return false;
  // Rate limits and outages are not a wrong password, and saying so would
  // send the contractor hunting for a typo that isn't there.
  if (error) throw authFailure(error);

  await probe.auth.signOut({ scope: "local" });
  return true;
}
