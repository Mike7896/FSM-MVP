import { authFailure, requireSameOrigin, sessionBody } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { created } from "@/lib/api/response";
import { absoluteUrl } from "@/lib/env";
import { signUpSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { validatedSignupDestination } from "@/lib/membership/purchase-intent";

/**
 * `POST /api/v1/auth/sign-up`
 *
 * With email confirmation on, Supabase creates the user but no session, so
 * `session` comes back `null` — that is the "check your inbox" answer, not a
 * failure. With it off, the account is signed in on the spot, exactly as
 * sign-in would.
 *
 * The confirmation link lands on the web app's `/auth/confirm` whichever
 * client signed up. Routing it into a native app is a deep-link job for when
 * there is one.
 */
export const POST = handler(async (request) => {
  requireSameOrigin(request);
  const body = await readJson(request, signUpSchema);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: body.email,
    password: body.password,
    options: {
      // Journey 0: a new account lands on its first quote, never on an empty
      // dashboard. A nav bar with nothing behind it is the named failure mode.
      emailRedirectTo: absoluteUrl(`/auth/confirm?next=${encodeURIComponent(validatedSignupDestination(body.next))}`),
      data: { full_name: body.fullName || undefined },
    },
  });
  if (error) throw authFailure(error);

  return created({
    user: data.user ? { id: data.user.id, email: data.user.email ?? "" } : null,
    session: data.session ? sessionBody(data.session) : null,
  });
});
