import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { clientEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env";

/**
 * Request-scoped Supabase client for Server Components, Server Functions and
 * Route Handlers. A new client per request - never hoist this to a module
 * singleton, or one user's session leaks into another's request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. Safe to swallow: proxy.ts
            // refreshes the session on every request, so the write is not lost.
          }
        },
      },
    }
  );
}

/**
 * Service-role client. Bypasses RLS entirely - only for trusted server paths
 * such as the Stripe webhook, which has no user session to act on behalf of.
 * Never import this from anything that reaches the browser.
 */
export function createAdminClient() {
  const { SUPABASE_SECRET_KEY } = serverEnv();

  if (!SUPABASE_SECRET_KEY) {
    throw new Error(
      "SUPABASE_SECRET_KEY is required to create an admin client."
    );
  }

  return createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    {
      cookies: { getAll: () => [] },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
