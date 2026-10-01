import { bearerToken, requireSameOrigin } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { noContent } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

/**
 * `POST /api/v1/auth/sign-out`
 *
 * Ends the session the request carries — the bearer token's for a native
 * client, the cookie's (and the cookies with it) for the web app.
 *
 * **Idempotent: always a 204.** Signing out of a session that already ended is
 * not something a person can act on; the answer to "am I signed out?" is yes
 * either way.
 *
 * Scope is Supabase's default, `global` — every device signs out, which is
 * what the web app did before this was a route. Worth revisiting once there is
 * a phone app somebody would not expect to lose.
 */
export const POST = handler(async (request) => {
  requireSameOrigin(request);

  const supabase = await createClient();
  const bearer = bearerToken(request);

  if (bearer) {
    await supabase.auth.admin.signOut(bearer);
  } else {
    await supabase.auth.signOut();
  }

  return noContent();
});
