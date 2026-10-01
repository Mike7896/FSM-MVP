import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Drizzle is the query layer for all application data. The Supabase JS client is
 * reserved for auth and storage, which are HTTP APIs rather than SQL.
 *
 * Connection notes:
 * - DATABASE_URL points at Supabase's *transaction* pooler (port 6543), which
 *   does not support prepared statements, hence `prepare: false`.
 * - This connects as the `postgres` role, which bypasses RLS. Authorization is
 *   therefore enforced in the Data Access Layer (lib/dal.ts) - every query must
 *   be scoped by organization id. RLS still exists as defence in depth for any
 *   access that arrives through PostgREST or the Supabase client.
 */

declare global {
  var __fsmDbClient: postgres.Sql | undefined;
  var __fsmDbPool: postgres.Sql | undefined;
}

/**
 * - **Ten connections, in dev as in production.** Dev used to run on one, and
 *   one connection is a single point of failure: when it wedged (a burst of
 *   queries fired at once through the transaction pooler), every page and API
 *   call queued behind it forever — public pages included.
 * - `connect_timeout` so a connection that can't be opened fails in seconds
 *   instead of hanging a request.
 * - `max_lifetime` recycles connections every few minutes, so one that has
 *   gone bad can't outlive the next recycle.
 */
function createClient() {
  const { DATABASE_URL } = serverEnv();
  return postgres(DATABASE_URL, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 5,
  });
}

// Reuse the pool across hot reloads in dev, otherwise every edit leaks a pool.
const client = globalThis.__fsmDbPool ?? createClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__fsmDbPool = client;
  // The old single-connection pool, from before this file changed: close it,
  // so a running dev server drops a wedged connection without a restart.
  if (globalThis.__fsmDbClient) {
    void globalThis.__fsmDbClient.end({ timeout: 1 }).catch(() => undefined);
    globalThis.__fsmDbClient = undefined;
  }
}

export const db = drizzle(client, { schema });
export { schema };
export type Database = typeof db;
