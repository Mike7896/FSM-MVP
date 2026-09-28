"use client";

import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/env";

/**
 * Browser Supabase client. Used for auth flows that must run client-side
 * (OAuth redirects, password recovery) and for Storage uploads straight from
 * the browser. Cookie handling is intentionally left to the library.
 */
export function createClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
