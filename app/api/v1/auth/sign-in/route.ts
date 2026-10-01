import { authFailure, requireSameOrigin, sessionBody } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { signInSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

/**
 * `POST /api/v1/auth/sign-in` — email and password.
 *
 * **One endpoint, both clients.** The session lands in cookies for the web app
 * and comes back in the body for a native client, which keeps its own tokens
 * and has no cookie jar. Handing the tokens to a browser exposes nothing new:
 * Supabase's session cookies are readable by page script by design.
 *
 * Never a redirect. Where a person goes after signing in is the client's call —
 * the web form navigates to `next`, a native app to its own first screen.
 */
export const POST = handler(async (request) => {
  requireSameOrigin(request);
  const body = await readJson(request, signInSchema);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(body);
  if (error) throw authFailure(error);

  return ok({
    user: { id: data.user.id, email: data.user.email ?? "" },
    session: sessionBody(data.session),
  });
});
