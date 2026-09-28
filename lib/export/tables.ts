import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  changeOrderDetails,
  contractDetails,
  customers,
  documents,
  invoiceDetails,
  jobs,
  ledgerEntries,
  permits,
  receipts,
} from "@/lib/db/schema";
import { quoteTotalExpression } from "@/lib/queries/scope-sql";

import { dollars, stamp, type CsvRow } from "./csv";

/**
 * Everything a shop can take out of here, one set of rows at a time.
 *
 * **Export is the promise that makes import safe**, and it is available always
 * rather than at cancellation — a contractor asked to put years of work into a
 * new tool is being asked to trust it with the only copy, and the answer is
 * that everything leaves as easily as it arrived.
 *
 * **Headings are what the rows are called out loud**, not column names. The
 * file is opened by a bookkeeper, in a spreadsheet, months from now: "Job
 * number" and "Amount" survive that trip, `job_id` and `amount_cents` do not.
 * Ids stay out of the CSVs entirely for the same reason — the JSON export is
 * where a machine-readable copy lives.
 *
 * **Practice jobs are left out.** A demo is not part of the business's record,
 * and it is excluded from every count and every total in the app already.
 */

export const EXPORT_TABLES = [
  { id: "customers", label: "Customers", file: "customers" },
  { id: "jobs", label: "Jobs", file: "jobs" },
  { id: "quotes", label: "Quotes", file: "quotes" },
  { id: "contracts", label: "Contracts", file: "contracts" },
  { id: "change-orders", label: "Change orders", file: "change-orders" },
  { id: "invoices", label: "Invoices", file: "invoices" },
  { id: "payments", label: "Payments", file: "payments" },
  { id: "receipts", label: "Receipts", file: "receipts" },
  { id: "permits", label: "Permits", file: "permits" },
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number]["id"];

/**
 * A set of rows, with its headings.
 *
 * The headings travel with the rows because an empty set still has to export a
 * usable file — a CSV whose only line is blank tells a contractor with no
 * invoices yet that the export is broken.
 */
export type ExportSet = { columns: string[]; rows: CsvRow[] };

export function isExportTable(value: string): value is ExportTable {
  return EXPORT_TABLES.some((table) => table.id === value);
}

/** Real jobs only — a demo is practice, and practice is not a record. */
const realJob = (organizationId: string) =>
  and(eq(jobs.organizationId, organizationId), eq(jobs.isDemo, false))!;

async function customerRows(organizationId: string): Promise<ExportSet> {
  const rows = await db
    .select({
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      address: customers.address,
      notes: customers.notes,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(
      and(
        eq(customers.organizationId, organizationId),
        eq(customers.isDemo, false)
      )
    )
    .orderBy(asc(customers.name));

  return {
    columns: [
    "Customer",
    "Email",
    "Phone",
    "Address",
    "Notes",
    "Added",
  ],
    rows: rows.map((row) => ({
    Customer: row.name,
    Email: row.email,
    Phone: row.phone,
    Address: row.address,
    Notes: row.notes,
    Added: stamp(row.createdAt),
  })),
  };
}

async function jobRows(organizationId: string): Promise<ExportSet> {
  const rows = await db
    .select({
      number: jobs.number,
      customer: customers.name,
      work: jobs.name,
      address: jobs.address,
      jurisdiction: jobs.jurisdiction,
      status: jobs.status,
      startsOn: jobs.startsOn,
      endsOn: jobs.endsOn,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(realJob(organizationId))
    .orderBy(asc(jobs.number));

  return {
    columns: [
    "Job number",
    "Customer",
    "Work",
    "Address",
    "Jurisdiction",
    "Status",
    "Starts on",
    "Ends on",
    "Created",
  ],
    rows: rows.map((row) => ({
    "Job number": row.number,
    Customer: row.customer,
    Work: row.work,
    Address: row.address,
    Jurisdiction: row.jurisdiction,
    Status: row.status.replace(/_/g, " "),
    "Starts on": row.startsOn,
    "Ends on": row.endsOn,
    Created: stamp(row.createdAt),
  })),
  };
}

/** The document spine, shared by quotes, contracts, change orders and bills. */
type DocumentType = (typeof documents.$inferSelect)["type"];

function documentBase(organizationId: string, type: DocumentType) {
  return db
    .select({
      number: documents.number,
      customer: customers.name,
      jobNumber: jobs.number,
      title: documents.title,
      status: documents.status,
      sentAt: documents.sentAt,
      createdAt: documents.createdAt,
      quoteTotalCents: sql<number>`${quoteTotalExpression(sql.raw('"documents"."id"'))}`,
      contractSumCents: contractDetails.contractSumCents,
      depositCents: contractDetails.depositCents,
      whatChanged: changeOrderDetails.whatChanged,
      deltaCents: changeOrderDetails.deltaCents,
      approvedAt: changeOrderDetails.approvedAt,
      invoiceType: invoiceDetails.invoiceType,
      amountDueCents: invoiceDetails.amountDueCents,
      dueOn: invoiceDetails.dueOn,
      covers: invoiceDetails.covers,
      voidedAt: invoiceDetails.voidedAt,
    })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(contractDetails, eq(contractDetails.documentId, documents.id))
    .leftJoin(
      changeOrderDetails,
      eq(changeOrderDetails.documentId, documents.id)
    )
    .leftJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.type, type),
        eq(jobs.isDemo, false)
      )
    )
    .orderBy(asc(documents.number));
}

async function quoteRows(organizationId: string): Promise<ExportSet> {
  const rows = await documentBase(organizationId, "quote");

  return {
    columns: [
    "Quote",
    "Customer",
    "Job number",
    "Work",
    "Status",
    "Total",
    "Sent",
    "Created",
  ],
    rows: rows.map((row) => ({
    Quote: row.number,
    Customer: row.customer,
    "Job number": row.jobNumber,
    Work: row.title,
    Status: row.status,
    Total: dollars(Number(row.quoteTotalCents ?? 0)),
    Sent: stamp(row.sentAt),
    Created: stamp(row.createdAt),
  })),
  };
}

async function contractRows(organizationId: string): Promise<ExportSet> {
  const rows = await documentBase(organizationId, "contract");

  return {
    columns: [
    "Contract",
    "Customer",
    "Job number",
    "Work",
    "Status",
    "Agreed price",
    "Deposit",
    "Sent",
    "Created",
  ],
    rows: rows.map((row) => ({
    Contract: row.number,
    Customer: row.customer,
    "Job number": row.jobNumber,
    Work: row.title,
    Status: row.status.replace(/_/g, " "),
    "Agreed price": dollars(row.contractSumCents),
    Deposit: dollars(row.depositCents),
    Sent: stamp(row.sentAt),
    Created: stamp(row.createdAt),
  })),
  };
}

async function changeOrderRows(organizationId: string): Promise<ExportSet> {
  const rows = await documentBase(organizationId, "change_order");

  return {
    columns: [
    "Change order",
    "Customer",
    "Job number",
    "What changed",
    "Status",
    "Difference",
    "Approved",
    "Created",
  ],
    rows: rows.map((row) => ({
    "Change order": row.number,
    Customer: row.customer,
    "Job number": row.jobNumber,
    "What changed": row.whatChanged ?? row.title,
    Status: row.status,
    Difference: dollars(row.deltaCents),
    Approved: stamp(row.approvedAt),
    Created: stamp(row.createdAt),
  })),
  };
}

async function invoiceRows(organizationId: string): Promise<ExportSet> {
  const rows = await documentBase(organizationId, "invoice");

  return {
    columns: [
    "Invoice",
    "Customer",
    "Job number",
    "Kind",
    "Covers",
    "Status",
    "Amount",
    "Due on",
    "Sent",
    "Withdrawn",
  ],
    rows: rows.map((row) => ({
    Invoice: row.number,
    Customer: row.customer,
    "Job number": row.jobNumber,
    Kind: row.invoiceType?.replace(/_/g, " ") ?? null,
    Covers: row.covers ?? row.title,
    Status: row.status,
    Amount: dollars(row.amountDueCents),
    "Due on": row.dueOn,
    Sent: stamp(row.sentAt),
    Withdrawn: stamp(row.voidedAt),
  })),
  };
}

/**
 * The money, as the ledger holds it: every entry, signed, in the order it
 * happened. Nothing here is ever edited or deleted — a mistake is corrected by
 * its opposite — so a reversal appears as its own row, which is what an
 * accountant needs to see rather than a number that quietly changed.
 */
async function paymentRows(organizationId: string): Promise<ExportSet> {
  const rows = await db
    .select({
      occurredAt: ledgerEntries.occurredAt,
      entryType: ledgerEntries.entryType,
      method: ledgerEntries.method,
      amountCents: ledgerEntries.amountCents,
      currency: ledgerEntries.currency,
      jobNumber: jobs.number,
      customer: customers.name,
      invoiceNumber: documents.number,
      source: ledgerEntries.source,
      memo: ledgerEntries.memo,
      externalRef: ledgerEntries.externalRef,
      reversesId: ledgerEntries.reversesId,
      recordedAt: ledgerEntries.recordedAt,
    })
    .from(ledgerEntries)
    .leftJoin(jobs, eq(ledgerEntries.jobId, jobs.id))
    .leftJoin(customers, eq(ledgerEntries.customerId, customers.id))
    .leftJoin(documents, eq(ledgerEntries.invoiceId, documents.id))
    .where(
      and(
        eq(ledgerEntries.organizationId, organizationId),
        // Shop-level money has no job at all, so this can't be an inner join.
        sql`(${jobs.id} is null or ${jobs.isDemo} = false)`
      )
    )
    .orderBy(asc(ledgerEntries.seq));

  return {
    columns: [
    "Date",
    "What",
    "How",
    "Amount",
    "Currency",
    "Customer",
    "Job number",
    "Invoice",
    "Memo",
    "Recorded by",
    "Provider reference",
    "Corrects an earlier entry",
    "Recorded",
  ],
    rows: rows.map((row) => ({
    Date: stamp(row.occurredAt),
    What: row.entryType.replace(/_/g, " "),
    How: row.method?.replace(/_/g, " ") ?? null,
    Amount: dollars(row.amountCents),
    Currency: row.currency.toUpperCase(),
    Customer: row.customer,
    "Job number": row.jobNumber,
    Invoice: row.invoiceNumber,
    Memo: row.memo,
    "Recorded by": row.source.replace(/_/g, " "),
    "Provider reference": row.externalRef,
    "Corrects an earlier entry": row.reversesId ? "yes" : "no",
    Recorded: stamp(row.recordedAt),
  })),
  };
}

async function receiptRows(organizationId: string): Promise<ExportSet> {
  const rows = await db
    .select({
      purchasedOn: receipts.purchasedOn,
      jobNumber: jobs.number,
      customer: customers.name,
      vendor: receipts.vendor,
      description: receipts.description,
      category: receipts.category,
      amountCents: receipts.amountCents,
      reconciled: receipts.reconciled,
      capturedAt: receipts.capturedAt,
    })
    .from(receipts)
    .innerJoin(jobs, eq(receipts.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(realJob(organizationId))
    .orderBy(desc(receipts.capturedAt));

  return {
    columns: [
    "Bought on",
    "Job number",
    "Customer",
    "Vendor",
    "What",
    "Category",
    "Amount",
    "Reconciled",
    "Logged",
  ],
    rows: rows.map((row) => ({
    "Bought on": row.purchasedOn,
    "Job number": row.jobNumber,
    Customer: row.customer,
    Vendor: row.vendor,
    What: row.description,
    Category: row.category,
    Amount: dollars(row.amountCents),
    Reconciled: row.reconciled,
    Logged: stamp(row.capturedAt),
  })),
  };
}

async function permitRows(organizationId: string): Promise<ExportSet> {
  const rows = await db
    .select({
      jobNumber: jobs.number,
      customer: customers.name,
      jurisdiction: permits.jurisdiction,
      type: permits.type,
      number: permits.number,
      status: permits.status,
      pulledBy: permits.pulledBy,
      feePaidCents: permits.feePaidCents,
      appliedOn: permits.appliedOn,
      issuedOn: permits.issuedOn,
      expiresOn: permits.expiresOn,
      scopeCovered: permits.scopeCovered,
    })
    .from(permits)
    .innerJoin(jobs, eq(permits.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(realJob(organizationId))
    .orderBy(asc(jobs.number));

  return {
    columns: [
    "Job number",
    "Customer",
    "Jurisdiction",
    "Type",
    "Permit number",
    "Status",
    "Pulled by",
    "Fee",
    "Applied on",
    "Issued on",
    "Expires on",
    "Covers",
  ],
    rows: rows.map((row) => ({
    "Job number": row.jobNumber,
    Customer: row.customer,
    Jurisdiction: row.jurisdiction,
    Type: row.type,
    "Permit number": row.number,
    Status: row.status.replace(/_/g, " "),
    "Pulled by": row.pulledBy === "shop" ? "Our business" : row.pulledBy,
    Fee: dollars(row.feePaidCents),
    "Applied on": row.appliedOn,
    "Issued on": row.issuedOn,
    "Expires on": row.expiresOn,
    Covers: row.scopeCovered,
  })),
  };
}

const BUILDERS: Record<
  ExportTable,
  (organizationId: string) => Promise<ExportSet>
> = {
  customers: customerRows,
  jobs: jobRows,
  quotes: quoteRows,
  contracts: contractRows,
  "change-orders": changeOrderRows,
  invoices: invoiceRows,
  payments: paymentRows,
  receipts: receiptRows,
  permits: permitRows,
};

export function exportRows(
  organizationId: string,
  table: ExportTable
): Promise<ExportSet> {
  return BUILDERS[table](organizationId);
}

/** Every set at once, for the single-file export and for the page's counts. */
export async function exportEverything(
  organizationId: string
): Promise<Record<ExportTable, ExportSet>> {
  const entries = await Promise.all(
    EXPORT_TABLES.map(
      async (table) =>
        [table.id, await exportRows(organizationId, table.id)] as const
    )
  );

  return Object.fromEntries(entries) as Record<ExportTable, ExportSet>;
}
