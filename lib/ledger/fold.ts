import "server-only";

import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { COLLECTION_TYPES, ledgerEntries, type LedgerEntry } from "@/lib/db/schema";

/**
 * THE FOLD — Money Ledger §3.
 *
 * **It is a flat array you reduce, not a linked list.** A linked list pays off
 * when you insert into the middle cheaply, and nothing is ever inserted into
 * the middle here — append-only means new rows always land on the end. Pointers
 * would cost storage and traversal and buy nothing.
 *
 * So every question below is the same shape the model already uses elsewhere
 * (Contract = initial state, change orders = events, current agreed scope = the
 * fold): start at zero, apply each row in `seq` order, out comes the answer. No
 * graph, no recursion, and the only hard requirement is a deterministic order —
 * which the global `seq` gives for free.
 *
 * **These folds run in SQL rather than in JavaScript.** The arithmetic is
 * identical; the difference is that a job with four years of entries does not
 * cross the wire to be summed. `foldEntries` below is the same reduction in
 * TypeScript, for the callers that already hold the rows.
 */

/**
 * The types that count toward *collected* — §5.
 *
 * Fees and payouts are real movements the contractor wants to see, but they do
 * not change what the homeowner has paid: a payout is a transfer between two
 * accounts he already owns, and Stripe's cut coming out of his balance does not
 * un-pay an invoice. Rendered once, here, so the six surfaces that ask this
 * question cannot drift into six slightly different answers.
 */
const COLLECTION_TYPES_SQL = sql.join(
  COLLECTION_TYPES.map((type) => sql`${type}`),
  sql`, `
);

/**
 * A correlated subquery summing collected cents for whatever job expression is
 * passed in.
 *
 * Exported as a fragment because several callers need this *inside* an existing
 * query — `jobMoney` walks the scope tree in the same statement, and pulling
 * the fold out into a second round trip to avoid a fragment would be slower and
 * no clearer. Refunds and chargebacks are negative rows, so a plain `sum` nets
 * them; there is no `- refunded_cents` term any more because there is no such
 * column and no such concept.
 */
export function collectedForJob(jobIdExpr: SQL | string): SQL {
  return sql`coalesce((
    select sum(le.amount_cents)
    from ledger_entries le
    where le.job_id = ${jobIdExpr}
      and le.entry_type in (${COLLECTION_TYPES_SQL})
  ), 0)`;
}

/** The same fold, narrowed to one invoice. */
export function collectedForInvoice(invoiceIdExpr: SQL | string): SQL {
  return sql`coalesce((
    select sum(le.amount_cents)
    from ledger_entries le
    where le.invoice_id = ${invoiceIdExpr}
      and le.entry_type in (${COLLECTION_TYPES_SQL})
  ), 0)`;
}

/** The same fold, narrowed to one customer across all their jobs. */
export function collectedForCustomer(customerIdExpr: SQL | string): SQL {
  return sql`coalesce((
    select sum(le.amount_cents)
    from ledger_entries le
    join jobs j on j.id = le.job_id
    where j.customer_id = ${customerIdExpr}
      and le.entry_type in (${COLLECTION_TYPES_SQL})
  ), 0)`;
}

/* ── Whole answers ────────────────────────────────────────────────────── */

/**
 * Collected to date for a set of jobs, keyed by job id.
 *
 * Batched rather than per-job because every surface that needs this needs it
 * for a list — the job index, the dashboard, the customer page — and a fold per
 * row is the N+1 that makes a money screen feel slow.
 */
export async function collectedByJob(
  jobIds: string[]
): Promise<Map<string, number>> {
  if (jobIds.length === 0) return new Map();

  const rows = await db
    .select({
      jobId: ledgerEntries.jobId,
      cents: sql<string>`sum(${ledgerEntries.amountCents})::text`,
    })
    .from(ledgerEntries)
    .where(
      and(
        inJobs(jobIds),
        sql`${ledgerEntries.entryType} in (${COLLECTION_TYPES_SQL})`
      )
    )
    .groupBy(ledgerEntries.jobId);

  const byJob = new Map<string, number>();
  for (const row of rows) {
    if (row.jobId) byJob.set(row.jobId, Number(row.cents));
  }
  return byJob;
}

function inJobs(jobIds: string[]): SQL {
  const values = sql.join(
    jobIds.map((id) => sql`${id}::uuid`),
    sql`, `
  );
  return sql`${ledgerEntries.jobId} in (${values})`;
}

/**
 * Every entry on one job, in fold order.
 *
 * The job's money timeline, and half of the dispute packet — the other half
 * being the document events, which are merged in at export time rather than
 * stored pre-merged.
 */
export async function jobEntries(
  jobId: string,
  organizationId: string
): Promise<LedgerEntry[]> {
  return db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.organizationId, organizationId),
        eq(ledgerEntries.jobId, jobId)
      )
    )
    .orderBy(asc(ledgerEntries.seq));
}

export type AccountMoney = {
  /** Everything collected across every job, net of refunds and chargebacks. */
  collectedCents: number;
  /** Stripe's cut, as a positive number for display. */
  processingFeesCents: number;
  /** Our cut, as a positive number for display. */
  applicationFeesCents: number;
  /** Moved to the contractor's bank, as a positive number for display. */
  paidOutCents: number;
  /** Collected but not yet paid out — roughly the Stripe balance. */
  undepositedCents: number;
};

/**
 * The shop-wide money answer — one query on one table, no `job_id` filter.
 *
 * This is the payoff §1 promised for keeping a ledger at all: "what did I
 * collect in August", "what is outstanding across all my jobs" and aging stop
 * being a walk over every document in the account and become a `sum` with a
 * `where`.
 *
 * Fees and payouts are returned as positive numbers because that is how a
 * contractor reads them — "$412 in Stripe fees", not "−$412". The sign lives in
 * the table; the presentation does not inherit it.
 */
export async function accountMoney(
  organizationId: string,
  window?: { from?: Date; to?: Date }
): Promise<AccountMoney> {
  const bounds: SQL[] = [eq(ledgerEntries.organizationId, organizationId)];
  if (window?.from) bounds.push(sql`${ledgerEntries.occurredAt} >= ${window.from}`);
  if (window?.to) bounds.push(sql`${ledgerEntries.occurredAt} < ${window.to}`);

  const [row] = await db
    .select({
      collected: sql<string>`coalesce(sum(${ledgerEntries.amountCents})
        filter (where ${ledgerEntries.entryType} in (${COLLECTION_TYPES_SQL})), 0)::text`,
      processingFees: sql<string>`coalesce(sum(${ledgerEntries.amountCents})
        filter (where ${ledgerEntries.entryType} = 'processing_fee'), 0)::text`,
      applicationFees: sql<string>`coalesce(sum(${ledgerEntries.amountCents})
        filter (where ${ledgerEntries.entryType} = 'application_fee'), 0)::text`,
      paidOut: sql<string>`coalesce(sum(${ledgerEntries.amountCents})
        filter (where ${ledgerEntries.entryType} = 'payout'), 0)::text`,
    })
    .from(ledgerEntries)
    .where(and(...bounds));

  const collectedCents = Number(row?.collected ?? 0);
  const processingFeesCents = -Number(row?.processingFees ?? 0);
  const applicationFeesCents = -Number(row?.applicationFees ?? 0);
  const paidOutCents = -Number(row?.paidOut ?? 0);

  return {
    collectedCents,
    processingFeesCents,
    applicationFeesCents,
    paidOutCents,
    // What has landed but not yet moved to the bank. Fees come out of the
    // Stripe balance too, so they belong in this subtraction — a contractor who
    // is told he has $8,400 waiting and receives $8,156 stops trusting the
    // number.
    undepositedCents:
      collectedCents - processingFeesCents - applicationFeesCents - paidOutCents,
  };
}

/**
 * Money that arrived with no job attached and is waiting to be attributed.
 *
 * The bank-feed matcher's inbox: a Plaid deposit lands before anyone knows
 * which job it is for, and it sits here until the contractor confirms a match.
 * Payouts and fees are excluded because they are shop money permanently, not
 * job money awaiting a home.
 */
export async function unattributedEntries(
  organizationId: string
): Promise<LedgerEntry[]> {
  return db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.organizationId, organizationId),
        isNull(ledgerEntries.jobId),
        sql`${ledgerEntries.entryType} in (${COLLECTION_TYPES_SQL})`
      )
    )
    .orderBy(asc(ledgerEntries.seq));
}

/* ── The same fold, in memory ─────────────────────────────────────────── */

/**
 * Reduce rows the caller already holds. Identical arithmetic to the SQL above,
 * for the surfaces that fetched the entries to render them anyway and should
 * not go back to the database to add them up.
 */
export function foldEntries(entries: readonly LedgerEntry[]): number {
  const counted = new Set<string>(COLLECTION_TYPES);
  return entries
    .filter((entry) => counted.has(entry.entryType))
    .reduce((sum, entry) => sum + entry.amountCents, 0);
}
