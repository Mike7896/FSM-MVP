import "server-only";

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { syncJobs } from "@/lib/db/schema";
import { isConnectorError } from "./oauth";
import type { ConnectorProvider } from "./registry";

/**
 * THE OUTBOUND QUEUE — everything this product owes an external system.
 *
 * ## Why pushes are queued and never inline
 *
 * A contractor sending an invoice must not wait on QuickBooks, and must not
 * fail because QuickBooks is down. Inline pushes make an outage in somebody
 * else's system into an outage in this one, and they make the slowest provider
 * the speed of the product.
 *
 * The queue is also what turns *"the sync broke"* into *"three rows are
 * pending"* — the difference between a support ticket and a status the Office
 * can show. Silent failure corrupts books and trust; a row with a reason on it
 * is neither silent nor a mystery.
 *
 * ## Idempotency is the thing that stops double-billing
 *
 * The key is derived from *what* is being pushed and *which version of it*, so
 * a retry after an ambiguous timeout re-sends the same key rather than creating
 * a second invoice in somebody's books. The unique index is where that stops
 * being a convention and starts being enforced.
 *
 * A push is corrected with a later document — a credit memo — never by deleting
 * what was already sent. That is an accounting act, and it is the brief's rule:
 * **never delete in the provider.**
 */

/** Give up after this many tries and ask for a human. */
const MAX_ATTEMPTS = 6;

/**
 * Backoff, in minutes, per attempt.
 *
 * Front-loaded because most failures are transient and clear in seconds;
 * back-loaded because the ones that do not are usually a revoked grant, and
 * hammering a provider over a permission problem is how an app gets rate
 * limited into a worse one. The last step is over a day, which is deliberate:
 * by then a person needs to look.
 */
const BACKOFF_MINUTES = [1, 5, 30, 120, 720, 1440];

export type EnqueueInput = {
  organizationId: string;
  provider: ConnectorProvider;
  /** "push_customer" · "push_invoice" · "push_payment" · "pull_transactions". */
  operation: string;
  entity: string;
  localId: string;
  /**
   * What makes this push *this* push.
   *
   * Include whatever changes when the thing changes — an updated-at, a status,
   * a total. Omit it and a corrected invoice is silently deduped against the
   * original and never reaches the books.
   */
  idempotencyKey: string;
  payload?: Record<string, unknown>;
};

/**
 * Queue a push, or recognise that it is already queued.
 *
 * **Enqueueing twice is not an error.** The callers are document writes and
 * webhooks, both of which legitimately fire more than once for one real event,
 * so a duplicate is the expected case and returning quietly is the correct
 * behaviour.
 */
export async function enqueue(input: EnqueueInput): Promise<string | null> {
  const [row] = await db
    .insert(syncJobs)
    .values({
      organizationId: input.organizationId,
      provider: input.provider,
      operation: input.operation,
      entity: input.entity,
      localId: input.localId,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
    })
    .onConflictDoNothing({
      target: [
        syncJobs.organizationId,
        syncJobs.provider,
        syncJobs.idempotencyKey,
      ],
    })
    .returning({ id: syncJobs.id });

  return row?.id ?? null;
}

export type ClaimedJob = typeof syncJobs.$inferSelect;

/**
 * Take the next batch of due work, and mark it taken in the same statement.
 *
 * **The claim is the lock.** `for update skip locked` inside a single
 * `update ... returning` is what lets two concurrent drains run without both
 * picking up the same row — which matters because Vercel will happily invoke a
 * cron route again while the previous one is still going, and a double-claimed
 * invoice push is a double-billed customer.
 */
export async function claimDue(limit = 20): Promise<ClaimedJob[]> {
  // Built through the query builder rather than as raw SQL, and that is not a
  // style preference: `db.execute` hands back the database's own column names,
  // so a `returning *` there yields `organization_id` and every camelCase read
  // of the result is silently `undefined`. The builder maps them.
  const due = db
    .select({ id: syncJobs.id })
    .from(syncJobs)
    .where(
      and(
        inArray(syncJobs.status, ["pending", "failed"]),
        lte(syncJobs.nextAttemptAt, new Date())
      )
    )
    .orderBy(asc(syncJobs.nextAttemptAt))
    .limit(limit)
    .for("update", { skipLocked: true });

  return db
    .update(syncJobs)
    .set({
      status: "in_flight",
      attempts: sql`${syncJobs.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(inArray(syncJobs.id, due))
    .returning();
}

export async function succeed(jobId: string, remoteId: string | null) {
  await db
    .update(syncJobs)
    .set({
      status: "succeeded",
      remoteId,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(syncJobs.id, jobId));
}

/**
 * Record a failure and decide whether it is worth trying again.
 *
 * **A `reauth` failure is dead on the first attempt.** Retrying a revoked grant
 * cannot succeed, and a queue full of rows that will never work is a queue
 * whose depth stops meaning anything. It goes straight to `dead` so the Office
 * can ask the contractor to reconnect, which is the only thing that fixes it.
 */
export async function fail(
  job: ClaimedJob,
  error: unknown
): Promise<"retry" | "dead"> {
  const permanent =
    isConnectorError(error) &&
    (error.kind === "reauth" || error.kind === "config");

  const exhausted = job.attempts >= MAX_ATTEMPTS;
  const dead = permanent || exhausted;

  const minutes =
    BACKOFF_MINUTES[Math.min(job.attempts, BACKOFF_MINUTES.length - 1)];

  await db
    .update(syncJobs)
    .set({
      status: dead ? "dead" : "failed",
      lastError: message(error),
      nextAttemptAt: dead
        ? new Date()
        : new Date(Date.now() + minutes * 60_000),
      updatedAt: new Date(),
    })
    .where(eq(syncJobs.id, job.id));

  return dead ? "dead" : "retry";
}

/**
 * What the contractor reads on the sync-health list.
 *
 * Never a raw provider error: "Fault: 6240 Duplicate Name Exists Error" tells
 * them nothing they can act on. Where a message is not already plain, this
 * keeps the shape of one.
 */
function message(error: unknown): string {
  if (isConnectorError(error)) return error.message;
  if (error instanceof Error) return error.message.slice(0, 300);
  return "That didn't go through, and the reason wasn't recorded.";
}

/** What the Office shows: how much is waiting, and what has stopped. */
export async function queueHealth(organizationId: string) {
  const rows = await db
    .select({
      provider: syncJobs.provider,
      status: syncJobs.status,
      count: sql<string>`count(*)`,
    })
    .from(syncJobs)
    .where(
      and(
        eq(syncJobs.organizationId, organizationId),
        inArray(syncJobs.status, ["pending", "failed", "dead"])
      )
    )
    .groupBy(syncJobs.provider, syncJobs.status);

  return rows.map((row) => ({
    provider: row.provider,
    status: row.status,
    count: Number(row.count),
  }));
}

/** The rows that have given up, so a person can be shown what to do. */
export async function listDead(organizationId: string, limit = 50) {
  return db
    .select()
    .from(syncJobs)
    .where(
      and(
        eq(syncJobs.organizationId, organizationId),
        eq(syncJobs.status, "dead")
      )
    )
    .orderBy(asc(syncJobs.updatedAt))
    .limit(limit);
}

/** Put dead rows back after the contractor fixed whatever was wrong. */
export async function retryDead(
  organizationId: string,
  provider: ConnectorProvider
): Promise<number> {
  const rows = await db
    .update(syncJobs)
    .set({
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(syncJobs.organizationId, organizationId),
        eq(syncJobs.provider, provider),
        eq(syncJobs.status, "dead")
      )
    )
    .returning({ id: syncJobs.id });

  return rows.length;
}

/** Rows that are due right now, for the drain's own logging. */
export async function dueCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(syncJobs)
    .where(
      and(
        inArray(syncJobs.status, ["pending", "failed"]),
        lte(syncJobs.nextAttemptAt, new Date())
      )
    );

  return Number(row?.count ?? 0);
}
