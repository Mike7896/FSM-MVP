import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  ledgerEntries,
  type LedgerEntry,
  type LedgerEntryType,
  type LedgerSource,
} from "@/lib/db/schema";
import type { paymentMethodEnum } from "@/lib/db/schema";

/**
 * THE ONE DOOR INTO THE LEDGER — Money Ledger §11, items 3 and 4.
 *
 * **Every caller goes through `recordEntry`. There are no direct inserts.** A
 * webhook, the bank-feed matcher and a contractor typing a cheque into a form
 * all arrive here, which is what makes "how did this row get written" a
 * question with one answer.
 *
 * The database backs this up rather than trusting it — 0009 enforces the
 * append-only rule, the sign each entry type may carry, and the arithmetic a
 * reversal has to satisfy. This module is the ergonomic door; those are the
 * locks.
 */

export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];

export type RecordEntryInput = {
  organizationId: string;
  entryType: LedgerEntryType;
  /**
   * SIGNED cents. Positive is money toward the contractor.
   *
   * Callers pass the sign rather than having it inferred, because inferring it
   * would mean this function silently rewriting an amount a webhook handler got
   * wrong — and a silently corrected amount is a bug that never surfaces.
   */
  amountCents: number;
  /** When the money moved in the real world, not when we heard about it. */
  occurredAt: Date;
  source: LedgerSource;

  /** Null or omitted means shop money — a payout, a fee, an unmatched deposit. */
  jobId?: string | null;
  invoiceId?: string | null;
  customerId?: string | null;

  currency?: string;
  method?: PaymentMethod | null;
  /** Required in practice for `stripe` and `plaid_match`; see below. */
  externalRef?: string | null;
  memo?: string | null;
  /** Null means a webhook or the matcher wrote it, not a person. */
  createdBy?: string | null;
};

/** The natural sign of each type — §5's Sign column. `null` means either. */
const SIGN: Record<LedgerEntryType, 1 | -1 | null> = {
  payment_received: 1,
  chargeback_reversed: 1,
  refund_issued: -1,
  chargeback_opened: -1,
  processing_fee: -1,
  application_fee: -1,
  payout: -1,
  adjustment: null,
};

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

/**
 * Appends one entry, or does nothing if it is already there.
 *
 * **Returns `null` on a duplicate**, and that is the normal path rather than an
 * error. Stripe delivers duplicate webhooks as ordinary operation and the
 * bank-feed poller redelivers too, so a replay must be a no-op — the unique
 * index on `(organization, source, external_ref)` is what makes it one, and
 * `onConflictDoNothing` is what turns the collision into silence instead of a
 * 500 that Stripe would then retry forever.
 *
 * A caller that needs the row either way should read it back by `externalRef`;
 * `recordEntryOnce` below does exactly that.
 */
export async function recordEntry(
  input: RecordEntryInput
): Promise<LedgerEntry | null> {
  validate(input);

  const [row] = await db
    .insert(ledgerEntries)
    .values({
      organizationId: input.organizationId,
      entryType: input.entryType,
      amountCents: input.amountCents,
      occurredAt: input.occurredAt,
      source: input.source,
      jobId: input.jobId ?? null,
      invoiceId: input.invoiceId ?? null,
      customerId: input.customerId ?? null,
      currency: input.currency ?? "usd",
      method: input.method ?? null,
      externalRef: input.externalRef ?? null,
      memo: input.memo ?? null,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoNothing()
    .returning();

  return row ?? null;
}

/**
 * `recordEntry`, but returns the existing row on a duplicate instead of null.
 *
 * For the callers that need the entry in hand — a webhook that goes on to
 * update an invoice's status, say — and that must behave identically on a
 * first delivery and a replay.
 */
export async function recordEntryOnce(
  input: RecordEntryInput & { externalRef: string }
): Promise<LedgerEntry> {
  const created = await recordEntry(input);
  if (created) return created;

  const [existing] = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.organizationId, input.organizationId),
        eq(ledgerEntries.source, input.source),
        eq(ledgerEntries.externalRef, input.externalRef)
      )
    )
    .limit(1);

  if (!existing) {
    // The insert conflicted but nothing matches the key we conflicted on. That
    // is a constraint we did not intend to hit, and guessing is worse than
    // stopping.
    throw new LedgerError(
      `Ledger insert for ${input.source}:${input.externalRef} conflicted, ` +
        `but no existing entry matches it. Check the table's constraints.`
    );
  }

  return existing;
}

/**
 * Corrects a wrong entry by appending its opposite — Money Ledger §6.
 *
 * **Nothing is ever updated or deleted.** A Plaid match against the wrong job
 * is fixed with three rows, not one edit:
 *
 * ```
 * seq 41   payment_received   +$2,000   job A   (wrong)
 * seq 58   payment_received   −$2,000   job A   reverses 41
 * seq 59   payment_received   +$2,000   job B   (corrected)
 * ```
 *
 * Job A folds to zero, job B folds to $2,000, and both the mistake and the fix
 * survive — which is what a dispute packet and an auditor need, and what makes
 * a match-and-confirm flow safe to ship at all.
 *
 * Re-attribution is deliberately *not* done here. This writes the middle row
 * only; the caller writes the third with `recordEntry`, because a helper that
 * silently moved money between jobs would be one call away from doing it by
 * accident.
 */
export async function reverseEntry(
  entryId: string,
  { memo, createdBy }: { memo: string; createdBy?: string | null }
): Promise<LedgerEntry> {
  if (!memo.trim()) {
    throw new LedgerError(
      "A reversal needs a memo. The row survives forever and the next person " +
        "to read it will not remember why it is there."
    );
  }

  const [original] = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.id, entryId))
    .limit(1);

  if (!original) {
    throw new LedgerError(`No ledger entry ${entryId} to reverse.`);
  }

  if (original.reversesId) {
    throw new LedgerError(
      `Entry ${entryId} is itself a reversal. Reversing a reversal is a new ` +
        `entry with a memo saying so, not a chain.`
    );
  }

  const [row] = await db
    .insert(ledgerEntries)
    .values({
      organizationId: original.organizationId,
      // Same type, opposite sign — the database checks both.
      entryType: original.entryType,
      amountCents: -original.amountCents,
      // The correction happened now. Backdating it to the original's
      // `occurredAt` would put a mistake and its fix at the same instant and
      // make the timeline unreadable at exactly the moment it matters.
      occurredAt: new Date(),
      source: original.source,
      jobId: original.jobId,
      invoiceId: original.invoiceId,
      customerId: original.customerId,
      currency: original.currency,
      method: original.method,
      // The unique index is partial, so leaving this null keeps the original's
      // external id the only row claiming it — a later redelivery of that same
      // Stripe event still dedupes against the original rather than sneaking
      // past because the reversal took its key.
      externalRef: null,
      reversesId: original.id,
      memo,
      createdBy: createdBy ?? null,
    })
    .returning();

  return row;
}

/* ── Validation ───────────────────────────────────────────────────────── */

function validate(input: RecordEntryInput) {
  if (!Number.isInteger(input.amountCents)) {
    throw new LedgerError(
      `Ledger amounts are integer cents; got ${input.amountCents}. ` +
        `A fractional cent means a float got into the money path.`
    );
  }

  if (input.amountCents === 0) {
    throw new LedgerError(
      "Zero never moved. A ledger row that changes nothing is noise in an " +
        "audit trail."
    );
  }

  const sign = SIGN[input.entryType];
  if (sign !== null && Math.sign(input.amountCents) !== sign) {
    throw new LedgerError(
      `A ${input.entryType} must be ${sign > 0 ? "positive" : "negative"}; ` +
        `got ${input.amountCents}. To reverse an entry, use reverseEntry().`
    );
  }

  if (input.entryType === "payout" && input.jobId) {
    throw new LedgerError(
      "A payout belongs to no job — it is a transfer between two accounts " +
        "the contractor already owns and it settles nothing."
    );
  }

  if (input.entryType === "adjustment" && !input.memo?.trim()) {
    throw new LedgerError(
      "An adjustment needs a memo. It is the one entry type with no external " +
        "cause to point at, so the reason has to be written down."
    );
  }

  // Machine-written rows must carry the provider's id or they cannot dedupe,
  // and a webhook that redelivers without one silently doubles somebody's
  // money.
  if (input.source !== "manual" && !input.externalRef) {
    throw new LedgerError(
      `A ${input.source} entry needs an externalRef to deduplicate on. ` +
        `Without one a redelivery writes a second row.`
    );
  }
}
