import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";

import { serverEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";

// These transactions hold only advisory locks, never application rows. Keep
// their connections separate: waiting Stripe operations must not occupy every
// connection needed by the database work inside those same operations.
declare global {
  var __fsmOperationLocks: postgres.Sql | undefined;
}
const pool = globalThis.__fsmOperationLocks ?? postgres(serverEnv().DATABASE_URL, {
  prepare: false, max: 4, idle_timeout: 20, connect_timeout: 10, max_lifetime: 300,
});
if (process.env.NODE_ENV !== "production") globalThis.__fsmOperationLocks = pool;
const context = new AsyncLocalStorage<postgres.TransactionSql>();

/** Serialize external effects; a crash releases the lock, not the durable intent. */
export async function withOperationLock<T>(key: string, namespace: number, work: () => Promise<T>): Promise<T> {
  async function run(tx: postgres.TransactionSql) {
    const [row] = await tx<{ acquired: boolean }[]>`
      select pg_try_advisory_xact_lock(hashtextextended(${key}::text, ${namespace}::bigint)) as acquired
    `;
    if (!row.acquired) throw new DomainError("Another operation is in progress. Please try again in a moment.", "conflict");
    return context.run(tx, work);
  }
  const existing = context.getStore();
  if (existing) return run(existing);
  let result: T;
  await pool.begin(async (tx) => { result = await run(tx); });
  return result!;
}
