import { authFailure, requireSameOrigin } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { noContent } from "@/lib/api/response";
import { absoluteUrl } from "@/lib/env";
import { passwordResetSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

/**
 * `POST /api/v1/auth/password-reset` — email a link that sets a new password.
 *
 * **The same 204 whether or not the address has an account**, so this cannot
 * be used to find out who is a customer. Supabase answers an unknown address
 * the same way; the only failures that surface are about the request itself,
 * like asking too often.
 *
 * It is also how a Google-only contractor sets a *first* password — there is
 * no current one to re-authenticate with, so Account points them here.
 *
 * The link lands on `/auth/confirm`, which signs the session in and forwards
 * to `/reset-password`. That fresh session is the proof
 * `PUT /api/v1/auth/password` accepts in place of the current password.
 */
export const POST = handler(async (request) => {
  requireSameOrigin(request);
  const { email } = await readJson(request, passwordResetSchema);

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: absoluteUrl("/auth/confirm?next=/reset-password"),
  });
  if (error) throw authFailure(error);

  return noContent();
});
