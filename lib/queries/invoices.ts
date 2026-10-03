import "server-only";

import { and, asc, desc, eq, isNull, lt, notInArray, sql, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  documents,
  invoiceDetails,
  jobs,
  ledgerEntries,
  shareLinks,
} from "@/lib/db/schema";
import { collectedForInvoice } from "@/lib/ledger";

/**
 * Reading invoices — `documents` of type `invoice` plus their details.
 *
 * **One object, three moments** — a deposit is an Invoice issued at signing, a
 * draw is one released against a met gate, a final balance is one at
 * completion. They list together because they are the same thing at different
 * points, not three documents that happen to look alike.
 *
 * **Paid is a fact about money, not a status somebody set.** Every figure here
 * that says what was paid comes from the ledger fold, and "settled" is derived
 * from it — a stored `paid` that disagreed with the ledger is the kind of bug
 * that gets a customer chased for a bill they already settled.
 */

/**
 * Drizzle renders an embedded column **unqualified** inside a `sql` template in
 * a `.select()` projection, which is ambiguous inside a correlated subquery
 * over `ledger_entries` (42702). This is the explicit reference.
 */
const DOCUMENT_ID = sql.raw('"documents"."id"');

/** The ledger fold, narrowed to this invoice. Refunds are negative rows. */
const PAID_CENTS = sql<string>`${collectedForInvoice(DOCUMENT_ID)}::text`;

/**
 * Money on its way — a bank payment Stripe is still clearing (Billing §8.3).
 * Reserved against the balance, never counted as paid.
 */
const PROCESSING_CENTS = sql<string>`(
  select coalesce(sum(pa.amount_cents), 0) from payment_attempts pa
  where pa.invoice_id = ${DOCUMENT_ID} and pa.status = 'processing'
)::text`;

/** When the latest money against it landed — the ledger's moment. */
const LAST_PAID_AT = sql<string | null>`(
  select max(le.occurred_at) from ledger_entries le
  where le.invoice_id = ${DOCUMENT_ID} and le.entry_type = 'payment_received'
)`;

export type InvoiceType = (typeof invoiceDetails.invoiceType.enumValues)[number];

/** An invoice's closed status set — `lib/documents/lifecycle.ts`. */
export type InvoiceStatus = "draft" | "issued" | "sent" | "viewed" | "paid" | "void";

/**
 * What is actually true, rather than what the row says.
 *
 * **`overdue` is derived, never stored.** A stored one would need something to
 * run every night and flip it, and the first night that failed the list would be
 * quietly wrong about who owes money.
 */
export type EffectiveInvoiceStatus = InvoiceStatus | "overdue" | "processing";

export type InvoiceListItem = {
  id: string;
  /** `INV-0007`. */
  number: string;
  jobId: string;
  customerName: string;
  type: InvoiceType;
  status: InvoiceStatus;
  effectiveStatus: EffectiveInvoiceStatus;
  covers: string | null;
  dueOn: string | null;
  amountDueCents: number;
  paidCents: number;
  outstandingCents: number;
  /** A bank payment still clearing. Not paid until Stripe says it succeeded. */
  processingCents: number;
  /** Zero unless it is genuinely late. */
  daysPastDue: number;
  issuedAt: Date | null;
  sentAt: Date | null;
  paidAt: Date | null;
};

export async function listInvoices(
  organizationId: string,
  options?: {
    jobId?: string;
    /** Several jobs at once — the jobs list reads every row's bills in one go. */
    jobIds?: string[];
    status?: InvoiceStatus;
    type?: InvoiceType;
    overdue?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<InvoiceListItem[]> {
  const today = todayISO();
  const filters = [
    eq(documents.organizationId, organizationId),
    eq(documents.type, "invoice"),
  ];

  if (options?.jobId) filters.push(eq(documents.jobId, options.jobId));
  if (options?.jobIds) {
    if (options.jobIds.length === 0) return [];
    filters.push(inArray(documents.jobId, options.jobIds));
  }
  if (options?.status) filters.push(eq(documents.status, options.status));
  if (options?.type) filters.push(eq(invoiceDetails.invoiceType, options.type));
  if (options?.overdue) {
    // A draft is not money anyone owes, and a voided bill never was.
    filters.push(
      notInArray(documents.status, ["draft", "paid", "void"]),
      isNull(invoiceDetails.voidedAt),
      lt(invoiceDetails.dueOn, today)
    );
  }

  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      jobId: documents.jobId,
      customerName: customers.name,
      type: invoiceDetails.invoiceType,
      status: documents.status,
      covers: invoiceDetails.covers,
      dueOn: invoiceDetails.dueOn,
      amountDueCents: invoiceDetails.amountDueCents,
      issuedAt: documents.issuedAt,
      sentAt: documents.sentAt,
      voidedAt: invoiceDetails.voidedAt,
      paidCents: PAID_CENTS,
      processingCents: PROCESSING_CENTS,
      lastPaidAt: LAST_PAID_AT,
    })
    .from(documents)
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(...filters))
    .orderBy(
      options?.overdue ? asc(invoiceDetails.dueOn) : desc(documents.createdAt)
    )
    .limit(options?.limit ?? 50)
    .offset(options?.offset ?? 0);

  return rows.map((row) => decorate(row, today));
}

export type InvoiceDetail = InvoiceListItem & {
  jobName: string | null;
  /** `1` — the job's number, for "Job #1". */
  jobNumber: number;
  customerId: string;
  /** Where a send would go, when the customer has an address on file. */
  customerEmail: string | null;
  /** The contract or change order it bills. Null on a standalone invoice. */
  sourceDocumentId: string | null;
  /** Whether the milestone a draw depends on has been cleared. */
  gateMet: boolean;
  /** Present once the invoice has been shared. `/share/<token>` is her copy. */
  shareToken: string | null;
  /**
   * What actually moved against this invoice, in fold order.
   *
   * Every row is money: a payment, a refund, a chargeback, the reversal when a
   * chargeback goes the contractor's way. Listed rather than netted, because
   * "she paid $2,000 and $400 came back in March" is the fact a contractor
   * needs, and a single net figure hides the half that gets disputed.
   */
  entries: {
    id: string;
    entryType: (typeof ledgerEntries.entryType.enumValues)[number];
    amountCents: number;
    method: (typeof ledgerEntries.method.enumValues)[number] | null;
    source: (typeof ledgerEntries.source.enumValues)[number];
    occurredAt: Date;
    memo: string | null;
    /** Set when this row cancels an earlier one. */
    reversesId: string | null;
  }[];
};

export async function getInvoice(
  invoiceId: string,
  organizationId: string
): Promise<InvoiceDetail | null> {
  const today = todayISO();

  const [row] = await db
    .select({
      id: documents.id,
      number: documents.number,
      jobId: documents.jobId,
      jobName: jobs.name,
      jobNumber: jobs.number,
      customerId: customers.id,
      customerName: customers.name,
      customerEmail: customers.email,
      type: invoiceDetails.invoiceType,
      status: documents.status,
      covers: invoiceDetails.covers,
      dueOn: invoiceDetails.dueOn,
      amountDueCents: invoiceDetails.amountDueCents,
      issuedAt: documents.issuedAt,
      sentAt: documents.sentAt,
      voidedAt: invoiceDetails.voidedAt,
      sourceDocumentId: documents.sourceDocumentId,
      gateMetAt: invoiceDetails.gateMetAt,
      paidCents: PAID_CENTS,
      processingCents: PROCESSING_CENTS,
      lastPaidAt: LAST_PAID_AT,
    })
    .from(documents)
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(documents.id, invoiceId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "invoice")
      )
    )
    .limit(1);

  if (!row) return null;

  const [paid, [link]] = await Promise.all([
    db
      .select({
        id: ledgerEntries.id,
        entryType: ledgerEntries.entryType,
        amountCents: ledgerEntries.amountCents,
        method: ledgerEntries.method,
        source: ledgerEntries.source,
        occurredAt: ledgerEntries.occurredAt,
        memo: ledgerEntries.memo,
        reversesId: ledgerEntries.reversesId,
      })
      // Ordered by `seq`, not by `occurredAt`: two rows written in the same
      // second must not render two different ways, and the global sequence is
      // the only total order the ledger guarantees.
      .from(ledgerEntries)
      .where(eq(ledgerEntries.invoiceId, invoiceId))
      .orderBy(asc(ledgerEntries.seq)),

    db
      .select({ token: shareLinks.token })
      .from(shareLinks)
      .where(
        and(eq(shareLinks.documentId, invoiceId), isNull(shareLinks.revokedAt))
      )
      .orderBy(desc(shareLinks.createdAt))
      .limit(1),
  ]);

  const { gateMetAt, sourceDocumentId, jobName, jobNumber, customerId, customerEmail, ...rest } =
    row;

  return {
    ...decorate(rest, today),
    jobName,
    jobNumber,
    customerId,
    customerEmail,
    sourceDocumentId,
    gateMet: gateMetAt !== null,
    shareToken: link?.token ?? null,
    entries: paid,
  };
}

/**
 * What the shop is owed in total.
 *
 * Its own query rather than a sum of the page's rows: the list is paginated,
 * and a header that only totals the first fifty invoices understates the debt as
 * soon as a shop gets busy.
 */
export async function invoiceSummary(organizationId: string) {
  const today = todayISO();
  const owed = sql`(${invoiceDetails.amountDueCents} - ${collectedForInvoice(DOCUMENT_ID)})`;

  const [row] = await db
    .select({
      outstandingCents: sql<string>`coalesce(sum(greatest(${owed}, 0)), 0)::text`,
      openCount: sql<number>`count(*) filter (where ${owed} > 0)::int`,
      overdueCount: sql<number>`count(*) filter (
        where ${owed} > 0 and ${invoiceDetails.dueOn} < ${today}
      )::int`,
    })
    .from(documents)
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.type, "invoice"),
        notInArray(documents.status, ["draft", "paid", "void"]),
        isNull(invoiceDetails.voidedAt)
      )
    );

  return {
    outstandingCents: Number(row?.outstandingCents ?? 0),
    openCount: row?.openCount ?? 0,
    overdueCount: row?.overdueCount ?? 0,
  };
}

/* ── Derivation ───────────────────────────────────────────────────────── */

type Row = {
  id: string;
  number: string;
  jobId: string;
  customerName: string;
  type: InvoiceType;
  status: string;
  covers: string | null;
  dueOn: string | null;
  amountDueCents: number;
  issuedAt: Date | null;
  sentAt: Date | null;
  voidedAt: Date | null;
  paidCents: string;
  processingCents: string;
  lastPaidAt: string | Date | null;
};

function decorate(row: Row, today: string): InvoiceListItem {
  const paidCents = Number(row.paidCents);
  const processingCents = Number(row.processingCents ?? 0);
  const status = row.status as InvoiceStatus;

  const voided = row.voidedAt !== null || status === "void";
  // A voided bill is owed by nobody, whatever it said.
  const outstandingCents = voided ? 0 : row.amountDueCents - paidCents;
  // Settled by money actually received, not by somebody remembering to change
  // a status.
  const settled =
    !voided &&
    (status === "paid" || (status !== "draft" && outstandingCents <= 0));
  const late =
    !settled &&
    !voided &&
    status !== "draft" &&
    row.dueOn !== null &&
    row.dueOn < today;

  return {
    id: row.id,
    number: row.number,
    jobId: row.jobId,
    customerName: row.customerName,
    type: row.type,
    status,
    covers: row.covers,
    dueOn: row.dueOn,
    amountDueCents: row.amountDueCents,
    issuedAt: row.issuedAt,
    sentAt: row.sentAt,
    paidCents,
    outstandingCents,
    processingCents,
    paidAt: settled && row.lastPaidAt ? new Date(row.lastPaidAt) : null,
    // "Processing" is not "paid" (Billing §8.3): a bank payment still clearing
    // covers the balance but has not settled it.
    effectiveStatus: voided
      ? "void"
      : settled
        ? "paid"
        : processingCents >= outstandingCents && processingCents > 0
          ? "processing"
          : late
            ? "overdue"
            : status,
    daysPastDue: late ? daysBetween(row.dueOn!, today) : 0,
  };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.max(
    Math.round(
      (new Date(`${to}T12:00:00Z`).getTime() -
        new Date(`${from}T12:00:00Z`).getTime()) /
        86_400_000
    ),
    0
  );
}
