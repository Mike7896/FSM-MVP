import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { clientEnv } from "@/lib/env";

/**
 * Signed-out visitors may reach these; everything else requires a session.
 *
 * `/share` is the load-bearing one: the homeowner has no account and never gets
 * one, so redirecting a capability link to /login would defeat the mechanism
 * the whole Homeowner Experience is built on.
 */
const PUBLIC_ROUTES = [
  "/",
  "/pricing",
  "/for",
  "/legal",
  // Locked out is exactly when someone needs a way to a person.
  "/support",
  "/share",
  "/login",
  "/signup",
  "/auth/callback",
  "/auth/google",
  "/auth/confirm",
  "/auth/auth-code-error",
  "/forgot-password",
  "/reset-password",
];

function isPublic(pathname: string) {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

/**
 * Refreshes the Supabase session cookie and performs an *optimistic* auth
 * redirect.
 *
 * Two rules make this correct, and both are easy to break:
 *
 * 1. Nothing may run between `createServerClient` and the `getClaims()` call.
 *    A refresh that lands after the response is committed is silently lost, and
 *    the user gets logged out at random.
 * 2. The response returned here must be the one the cookie writes landed on.
 *    Building a fresh `NextResponse` afterwards drops the refreshed tokens.
 *
 * This is a redirect gate, not an authorization boundary - it only reads the
 * cookie. Real checks belong in the Data Access Layer (lib/dal.ts).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Stops a CDN caching a response that carries someone's Set-Cookie.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    }
  );

  // `data` itself is null when there is no session, so this cannot be
  // destructured one level deeper.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  const { pathname } = request.nextUrl;

  /**
   * The API never redirects.
   *
   * A browser being sent to /login is a fine answer for a page. For an API it
   * is useless: a native client or a Postman request follows the 307, gets an
   * HTML sign-in page with a 200 on it, and has no way to tell that from
   * success. Route handlers authenticate themselves via `requireCaller` and
   * answer with a real 401 and a JSON body.
   *
   * The session refresh above still runs, so cookie-authenticated calls from
   * the web app get their tokens rotated like any other request.
   */
  if (pathname.startsWith("/api/")) {
    return response;
  }

  if (!claims && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (claims && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
