import "server-only";

import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gt, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents, jobActivations, jobs } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";

import { readAccess } from "./access";
import { POLICY } from "./catalog";
import { reportError } from "@/lib/observability";

/**
 * FREE USAGE — three newly activated jobs per UTC calendar month (§3.1).
 *
 * A job is **activated** at its first externally usable commercial action:
 * sending its quote, contract, change order or invoice, or printing a
 * customer-ready copy. Everything after that on the same job — revisions,
 * options, deposits, draws, the final bill, a resend — is free, because the
 * row already exists and one row per job is the whole rule.
 *
 * **Reserve, then commit.** The slot is reserved before the send and committed
 * atomically with its customer link. Failures before publication release it;
 * failures after publication retain it. The reservation is taken
 * under a per-shop advisory lock, so two sends racing for the last slot
 * resolve to exactly one.
 *
 * Every shop's activations are recorded, paid or not, so a shop that drops to
 * Free mid-month starts from the month's real count.
 */

export type ActivationAction =
  | "quote_sent"
  | "contract_sent"
  | "change_order_sent"
  | "invoice_sent"
  | "payment"
  | "pdf";

/** `2026-09` — the UTC calendar month a moment belongs to. */
export function periodOf(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Midnight UTC on the first of next month. */
export function nextReset(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

export type ActivationUsage = {
  period: string;
  used: number;
  /** Null is unlimited. */
  limit: number | null;
  remaining: number | null;
  resetsAt: Date;
};

/** The refusal a Free shop meets at the fourth job — with what it needs to explain itself. */
export class ActivationLimitError extends DomainError {
  constructor(usage: ActivationUsage) {
    super(
      `You've used all ${usage.limit} free jobs for this month. Your draft is saved — upgrade to send it now, or it can go when your free jobs reset.`,
      "conflict",
      {
        reason: "free_limit",
        used: usage.used,
        limit: usage.limit,
        resetsAt: usage.resetsAt.toISOString(),
      }
    );
    this.name = "ActivationLimitError";
  }
}

function holdCutoff(now: Date) {
  return new Date(now.getTime() - POLICY.activationHoldMinutes * 60_000);
}

type Executor = Pick<typeof db, "select">;
type Writer = Pick<typeof db, "select" | "update" | "execute">;
const publication = new AsyncLocalStorage<Reservation>();

/** Slots taken this month: committed, or reserved by a send still in flight. */
async function countUsed(
  organizationId: string,
  now: Date,
  on: Executor = db,
  excludingJobId?: string
) {
  const [row] = await on
    .select({ n: sql<number>`count(*)::int` })
    .from(jobActivations)
    .where(
      and(
        eq(jobActivations.organizationId, organizationId),
        eq(jobActivations.period, periodOf(now)),
        or(
          eq(jobActivations.status, "committed"),
          gt(jobActivations.reservedAt, holdCutoff(now))
        ),
        excludingJobId ? ne(jobActivations.jobId, excludingJobId) : undefined
      )
    );
  return row?.n ?? 0;
}

export async function getActivationUsage(
  organizationId: string,
  now = new Date()
): Promise<ActivationUsage> {
  const [used, access] = await Promise.all([
    countUsed(organizationId, now),
    readAccess(organizationId, now),
  ]);
  const limit = access.features.monthlyActivations;
  return {
    period: periodOf(now),
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    resetsAt: nextReset(now),
  };
}

/** Has this job already used its slot? Then nothing about it is ever counted again. */
export async function isJobActivated(jobId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: jobActivations.status })
    .from(jobActivations)
    .where(eq(jobActivations.jobId, jobId))
    .limit(1);
  return row?.status === "committed";
}

type Slot = {
  jobId: string;
  organizationId: string;
  action: ActivationAction;
  actorUserId: string | null;
};

export type Reservation =
  | { kind: "exempt" }
  | ({ kind: "already" } & Slot)
  | ({ kind: "reserved"; token: string } & Slot);

export async function reserveActivation(input: {
  organizationId: string;
  jobId: string;
  action: ActivationAction;
  actorUserId?: string | null;
  now?: Date;
}): Promise<Reservation> {
  const now = input.now ?? new Date();

  const [job] = await db
    .select({ demo: jobs.isDemo, organizationId: jobs.organizationId })
    .from(jobs)
    .where(eq(jobs.id, input.jobId))
    .limit(1);

  if (!job || job.organizationId !== input.organizationId) {
    throw new DomainError("No job with that id.", "not_found");
  }
  // A demo goes to the contractor himself. It is never a job he is charged a slot for.
  if (job.demo) return { kind: "exempt" };

  // Read before the lock: the plan decides the limit, and it does not need to be locked.
  const access = await readAccess(input.organizationId, now);
  const limit = access.features.monthlyActivations;
  const slot: Slot = {
    jobId: input.jobId,
    organizationId: input.organizationId,
    action: input.action,
    actorUserId: input.actorUserId ?? null,
  };

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.organizationId}::text, 7))`
    );

    const [existing] = await tx
      .select()
      .from(jobActivations)
      .where(eq(jobActivations.jobId, input.jobId))
      .limit(1);

    if (existing?.status === "committed") {
      return { kind: "already", ...slot } as const;
    }
    if (!existing) {
      // Jobs published before the activation ledger was introduced remain
      // completable. Preserve their original month instead of spending a new slot.
      const [published] = await tx.select({ first: sql<string | null>`min(${documents.sentAt})` })
        .from(documents).where(and(eq(documents.jobId, input.jobId), eq(documents.organizationId, input.organizationId)));
      if (published?.first) {
        const first = new Date(published.first);
        await tx.insert(jobActivations).values({
          ...slot, token: randomUUID(), period: periodOf(first), status: "committed",
          reservedAt: first, committedAt: first,
        });
        return { kind: "already", ...slot } as const;
      }
    }
    if (existing && existing.reservedAt > holdCutoff(now)) {
      throw new DomainError("This job is already being published. Please retry when that finishes.", "conflict");
    }

    if (limit !== null) {
      const used = await countUsed(input.organizationId, now, tx, input.jobId);
      if (used >= limit) {
        throw new ActivationLimitError({
          period: periodOf(now),
          used,
          limit,
          remaining: 0,
          resetsAt: nextReset(now),
        });
      }
    }

    const token = randomUUID();
    const values = {
      jobId: input.jobId,
      organizationId: input.organizationId,
      period: periodOf(now),
      status: "reserved" as const,
      action: input.action,
      token,
      reservedAt: now,
      committedAt: null,
      actorUserId: input.actorUserId ?? null,
    };

    if (existing) {
      // A stale reservation from a request that died. Take it over.
      await tx.update(jobActivations).set(values).where(eq(jobActivations.jobId, input.jobId));
    } else {
      await tx.insert(jobActivations).values(values);
    }

    return { kind: "reserved", token, ...slot } as const;
  });
}

export async function commitActivation(reservation: Reservation, now = new Date(), on?: Writer): Promise<void> {
  if (reservation.kind !== "reserved") return;
  if (!on) return db.transaction(tx => commitActivation(reservation, now, tx));
  await on.execute(sql`select pg_advisory_xact_lock(hashtextextended(${reservation.organizationId}::text, 7))`);
  const [row] = await on.select().from(jobActivations).where(eq(jobActivations.jobId, reservation.jobId)).limit(1);
  if (row?.status === "committed") return;
  if (!row || row.token !== reservation.token) {
    throw new DomainError("This publication reservation expired. Please retry.", "conflict");
  }
  // A slow publication may cross a month or outlive its hold. Recheck while
  // locked before it becomes accessible, rather than stealing another slot.
  if (row.period !== periodOf(now) || row.reservedAt <= holdCutoff(now)) {
    const limit = (await readAccess(reservation.organizationId, now, on)).features.monthlyActivations;
    const used = await countUsed(reservation.organizationId, now, on, reservation.jobId);
    if (limit !== null && used >= limit) {
      throw new ActivationLimitError({ period: periodOf(now), used, limit, remaining: 0, resetsAt: nextReset(now) });
    }
  }
  await on.update(jobActivations).set({ status: "committed", committedAt: now, period: periodOf(now) })
    .where(and(eq(jobActivations.jobId, reservation.jobId), eq(jobActivations.token, reservation.token)));
}

/** Called in the very transaction that publishes a customer link. */
export async function commitDocumentPublication(jobId: string, on: Writer) {
  const reservation = publication.getStore();
  if (!reservation || reservation.kind === "exempt") return;
  if (reservation.jobId !== jobId) throw new DomainError("Publication belongs to another job.", "conflict");
  await commitActivation(reservation, new Date(), on);
}

export async function releaseActivation(reservation: Reservation) {
  if (reservation.kind !== "reserved") return;
  await db
    .delete(jobActivations)
    .where(
      and(
        eq(jobActivations.jobId, reservation.jobId),
        eq(jobActivations.token, reservation.token),
        eq(jobActivations.status, "reserved")
      )
    );
}

/**
 * Runs a send with its activation around it: reserved first, committed when
 * the send succeeds, released when it throws.
 */
export async function withActivation<T>(
  input: Parameters<typeof reserveActivation>[0],
  send: () => Promise<T>
): Promise<T> {
  const reservation = await reserveActivation(input);
  let delivered = false;
  try {
    const result = await publication.run(reservation, send);
    delivered = true;
    await commitActivation(reservation);
    return result;
  } catch (error) {
    if (!delivered) await releaseActivation(reservation).catch((release) =>
      reportError("[membership] couldn't release an activation:", release)
    );
    throw error;
  }
}

/**
 * The same, for a send that names a document rather than a job. A document
 * that doesn't exist (or isn't this shop's) skips straight to the send, which
 * refuses it in its own words.
 */
export async function withDocumentActivation<T>(
  input: {
    organizationId: string;
    documentId: string;
    action: ActivationAction;
    actorUserId?: string | null;
  },
  send: () => Promise<T>
): Promise<T> {
  const [document] = await db
    .select({ jobId: documents.jobId })
    .from(documents)
    .where(and(eq(documents.id, input.documentId), eq(documents.organizationId, input.organizationId)))
    .limit(1);

  if (!document?.jobId) return send();

  return withActivation(
    {
      organizationId: input.organizationId,
      jobId: document.jobId,
      action: input.action,
      actorUserId: input.actorUserId,
    },
    send
  );
}
