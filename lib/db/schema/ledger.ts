import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  char,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { authUsers } from "./auth";
import { documents } from "./document-spine";
import { ledgerEntryTypeEnum, ledgerSourceEnum, paymentMethodEnum } from "./enums";
import { jobs } from "./jobs";
import { customers, organizations } from "./office";

/**
 * THE LEDGER — Money Ledger §4. **The truth of what *moved*.**
 *
 * ## Two records, not one
 *
 * Documents are the truth of what is **owed**; this table is the truth of what
 * **moved**. Both are needed and neither subsumes the other.
 *
 * *Derived-only fails* because money routinely moves with no document behind
 * it. Seven months after the job the homeowner disputes a $3,000 deposit —
 * $3,000 leaves the contractor's Stripe balance and no invoice, contract or
 * change order changed. Under a documents-only model there is nowhere to put
 * it, and the workaround is a fake negative invoice: a record of something that
 * never happened. The same hole exists for partial refunds, a chargeback that
 * later reverses in the contractor's favour, Stripe's processing fee, our
 * application fee, and a bank payout.
 *
 * *Ledger-only fails* because an obligation is not a movement. A signed
 * contract creates $10,000 of owed money and moves nothing. Forcing obligations
 * into a cash ledger duplicates the invoice table and creates two numbers that
 * can silently disagree.
 *
 * So this ledger is **cash-only**: nothing is written here until money has
 * physically moved. A quote writes nothing. A signed contract writes nothing.
 * An approved change order writes nothing. An issued invoice writes nothing.
 *
 * ## One table per account, not one per job
 *
 * `jobId` is **nullable**, and that is the load-bearing part. The contractor
 * takes three card payments on Tuesday across three jobs; on Thursday Stripe
 * deposits one $8,400 lump into his bank. That payout is a real money event
 * with a real bank record and it belongs to **no job**. So does a monthly
 * Stripe fee debit, and so does a bank deposit that arrives before anyone knows
 * which job it is for.
 *
 * - A row **with** a `jobId` is job money.
 * - A row **without** one is shop money.
 * - *"The job's ledger" is a view* — filter by `jobId`. Same move the model
 *   already makes with current agreed scope being a view of the Contract after
 *   change orders.
 *
 * ## Three rules that are not negotiable
 *
 * - **Integer cents**, in a `bigint`. Never a float, never a loosely-used
 *   `numeric`. Floating-point money is a bug generator.
 * - **Signed amounts.** Positive is money toward the contractor, negative is
 *   money away. There is no `direction` column, so a fold is a `sum` and
 *   nothing more.
 * - **`occurredAt` and `recordedAt` are different columns.** A cheque written
 *   Monday and entered Friday is one event with two true timestamps. The
 *   dispute packet needs the first; the audit trail needs the second.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * The total order every fold reads — Money Ledger §7.
     *
     * Two rows written in the same second must not fold two ways, and
     * `occurredAt` alone cannot guarantee that. A single global `bigserial`
     * gives a total order across the whole table, which yields a deterministic
     * order inside any organization's subset for free — no per-tenant counter,
     * no lock contention.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /* ── Attribution ────────────────────────────────────────────────── */

    /**
     * **NULL means shop money, not missing data.** A payout, a monthly Stripe
     * fee and an unmatched bank deposit all legitimately belong to no job.
     *
     * `restrict` rather than `cascade`: deleting a job must not silently
     * destroy the record of money that moved on it. A job with ledger history
     * is closed, not deleted.
     */
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "restrict" }),

    /** Which obligation this settles, where it settles one. */
    invoiceId: uuid("invoice_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),

    /* ── The money ──────────────────────────────────────────────────── */

    entryType: ledgerEntryTypeEnum("entry_type").notNull(),
    /** SIGNED. Integer cents, never a float. */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("usd"),

    /* ── Time ───────────────────────────────────────────────────────── */

    /** When money moved in the real world. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** When we wrote the row. */
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /* ── Provenance ─────────────────────────────────────────────────── */

    source: ledgerSourceEnum("source").notNull(),
    /** How the money moved, on a payment or a refund. */
    method: paymentMethodEnum("method"),
    /**
     * The provider's own id — a Stripe `pi_`/`ch_`/`re_`/`py_`, or a Plaid
     * transaction id. Null on a manual entry, which has no external id to key
     * on; see the partial unique index below.
     */
    externalRef: text("external_ref"),

    /* ── Corrections — §6 ───────────────────────────────────────────── */

    /**
     * The row this one cancels. Set only on a reversing entry.
     *
     * Nothing here is ever updated or deleted, so a wrong row is fixed by
     * appending its opposite and pointing at it. Both the mistake and the fix
     * survive in the record, which is exactly what a dispute packet and an
     * auditor need — and it is why the bank-feed match-and-confirm flow is safe
     * to ship, because a bad match is recoverable without destroying evidence.
     */
    reversesId: uuid("reverses_id").references(
      (): AnyPgColumn => ledgerEntries.id,
      { onDelete: "restrict" }
    ),

    /* ── Audit ──────────────────────────────────────────────────────── */

    memo: text("memo"),
    /** NULL means a webhook or the matcher wrote it, not a person. */
    createdBy: uuid("created_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("ledger_entries_job_idx").on(t.organizationId, t.jobId, t.seq),
    index("ledger_entries_occurred_idx").on(t.organizationId, t.occurredAt),
    index("ledger_entries_invoice_idx").on(t.organizationId, t.invoiceId),

    /**
     * Idempotency — §7. Stripe delivers duplicate webhooks as normal
     * operation, and the bank-feed poller redelivers too, so a replay must be a
     * no-op insert conflict rather than a second payment.
     *
     * **Partial, and that is a correction to the design doc.** The doc
     * specifies `unique nulls not distinct (account, source, external_ref)`,
     * but `NULLS NOT DISTINCT` treats NULLs as *equal* — so with manual entries
     * carrying no `externalRef`, the second manual payment an organization ever
     * records would violate the constraint and, under the `on conflict do
     * nothing` write path, vanish silently. Keying only the rows that actually
     * have an external id gives the intended guarantee without that hole.
     */
    uniqueIndex("ledger_entries_external_ref_unique")
      .on(t.organizationId, t.source, t.externalRef)
      .where(sql`${t.externalRef} is not null`),

    /**
     * A row may be reversed once. A second reversal against the same entry is
     * a double credit, and it is the kind of mistake a retry loop makes.
     */
    uniqueIndex("ledger_entries_reverses_unique")
      .on(t.reversesId)
      .where(sql`${t.reversesId} is not null`),

    /** §5: a payout is shop money by definition — it settles nothing. */
    check(
      "ledger_entries_payout_has_no_job",
      sql`${t.entryType} <> 'payout' or ${t.jobId} is null`
    ),

    /**
     * §5: an adjustment is the one type with no external cause to point at, so
     * the reason has to be written down or the row is unauditable.
     */
    check(
      "ledger_entries_adjustment_has_memo",
      sql`${t.entryType} <> 'adjustment'
        or (${t.memo} is not null and length(btrim(${t.memo})) > 0)`
    ),

    /** Zero never moved. A row that changes nothing is noise in an audit trail. */
    check("ledger_entries_amount_nonzero", sql`${t.amountCents} <> 0`),

    /**
     * The sign a type is allowed to carry — §5's Sign column, enforced.
     *
     * `recordEntry` is documented as the single write path, but "documented"
     * is not a guarantee and this is somebody's money. A `refund_issued` that
     * landed positive would read as a collection and inflate what the homeowner
     * appears to have paid, which is the exact class of quiet error the ledger
     * exists to make impossible.
     *
     * **A reversal is exempt**, because a reversal is defined as the same type
     * with the opposite sign (§6): reversing a `payment_received` writes a
     * negative `payment_received`. `adjustment` is exempt in both directions —
     * being the escape hatch is its whole job, which is also why it is the one
     * type the schema demands a memo from.
     */
    check(
      "ledger_entries_sign_matches_type",
      sql`${t.reversesId} is not null
        or ${t.entryType} = 'adjustment'
        or (${t.entryType} in (
              'payment_received', 'chargeback_reversed'
            ) and ${t.amountCents} > 0)
        or (${t.entryType} in (
              'refund_issued', 'chargeback_opened',
              'processing_fee', 'application_fee', 'payout'
            ) and ${t.amountCents} < 0)`
    ),
  ]
);

/**
 * The types that roll into a job's **collected to date** — §5.
 *
 * Fees and payouts are real money movements the contractor wants to see, but
 * they do not change what the homeowner has paid. A payout in particular is a
 * transfer between two accounts the contractor already owns (Stripe balance →
 * his bank); it is recorded because it appears on his bank statement and the
 * bank-feed matcher must not double-count it, never because it settles
 * anything.
 */
export const COLLECTION_TYPES = [
  "payment_received",
  "refund_issued",
  "chargeback_opened",
  "chargeback_reversed",
  "adjustment",
] as const satisfies readonly LedgerEntryType[];

export type LedgerEntryType =
  (typeof ledgerEntryTypeEnum.enumValues)[number];
export type LedgerSource = (typeof ledgerSourceEnum.enumValues)[number];

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  organization: one(organizations, {
    fields: [ledgerEntries.organizationId],
    references: [organizations.id],
  }),
  job: one(jobs, { fields: [ledgerEntries.jobId], references: [jobs.id] }),
  invoice: one(documents, {
    fields: [ledgerEntries.invoiceId],
    references: [documents.id],
  }),
  customer: one(customers, {
    fields: [ledgerEntries.customerId],
    references: [customers.id],
  }),
  reverses: one(ledgerEntries, {
    fields: [ledgerEntries.reversesId],
    references: [ledgerEntries.id],
    relationName: "reversal",
  }),
}));

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
