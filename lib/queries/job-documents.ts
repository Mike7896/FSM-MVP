import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  changeOrderDetails,
  contractDetails,
  documents,
  invoiceDetails,
  jobs,
  quoteDetails,
  scopeNodes,
  type ScopeNode as ScopeNodeRow,
} from "@/lib/db/schema";
import { emptyDraft, totals } from "@/lib/quote";
import {
  previewRowsFrom,
  scopeTreeFromRows,
  type QuotePreviewRow,
} from "@/lib/queries/quotes";

/**
 * Every outbound document on one job, **in the order it happened**.
 *
 * The four documents the customer sees are direct children of the Job at the
 * same level — quote, contract, change order, invoice — and no one of them owns
 * the others. Laid out chronologically they stop being a list of links and
 * become the story of the job: *she was quoted this, she agreed to that, the
 * meter socket was corroded so it changed, and here is what she has been billed
 * since.*
 *
 * **That order is a read, not a pipeline.** Every document is creatable without
 * its upstream one, so the sequence is whatever actually happened, not a
 * template with gaps. A job with three invoices and no quote reads correctly.
 *
 * Each document is dated by **the moment it entered the story**: when it went
 * out, falling back to when it was made.
 */

export type JobDocumentKind = "quote" | "contract" | "change_order" | "invoice";

export type JobDocument = {
  kind: JobDocumentKind;
  id: string;
  /** The Job it hangs off — every document has exactly one. */
  jobId: string;
  href: string;
  /** The word on the page. A legal fact rather than a label. */
  documentType: string;
  /** `Q-0007`, `INV-0003`. */
  number: string | null;
  title: string | null;
  /** When it took its place in the job's story. */
  at: Date;
  status: string;
  /** What the document says it is worth. */
  totalCents: number;
  /** The first few lines, as they read on the page. */
  rows: QuotePreviewRow[];
};

/**
 * One job's documents.
 *
 * The job is the scope check: Drizzle bypasses RLS, so it is proved against
 * the organization before anything on it is read.
 */
export async function listJobDocuments(
  jobId: string,
  organizationId: string
): Promise<JobDocument[]> {
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);

  return job ? documentsFor([jobId]) : [];
}

/**
 * Everything sent to one customer, newest first.
 *
 * **A document reaches a customer through the Job, never directly** — that rule
 * is what keeps the model a tree, and it is why this gathers their jobs first.
 */
export async function listCustomerDocuments(
  customerId: string,
  organizationId: string,
  limit = 8
): Promise<JobDocument[]> {
  const theirJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.customerId, customerId),
        eq(jobs.organizationId, organizationId)
      )
    );

  if (theirJobs.length === 0) return [];

  const found = await documentsFor(theirJobs.map((row) => row.id));

  // Newest first here, and oldest first on a job. A single job is a story read
  // start to finish; a customer's history is a stack with the most recent on
  // top, because "what did I last send them" is the question being asked.
  return found.reverse().slice(0, limit);
}

async function documentsFor(jobIds: string[]): Promise<JobDocument[]> {
  const rows = await db
    .select({
      document: documents,
      quote: quoteDetails,
      contract: contractDetails,
      changeOrder: changeOrderDetails,
      invoice: invoiceDetails,
    })
    .from(documents)
    .leftJoin(quoteDetails, eq(quoteDetails.documentId, documents.id))
    .leftJoin(contractDetails, eq(contractDetails.documentId, documents.id))
    .leftJoin(changeOrderDetails, eq(changeOrderDetails.documentId, documents.id))
    .leftJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .where(inArray(documents.jobId, jobIds))
    .orderBy(asc(documents.createdAt));

  // The two documents whose content is rows: a quote, and the change order
  // that amends one — the same tree, which is why a change order reuses the
  // quote editor.
  const withScope = rows
    .filter(
      ({ document }) =>
        document.type === "quote" || document.type === "change_order"
    )
    .map(({ document }) => document.id);

  const nodes = withScope.length
    ? await db
        .select()
        .from(scopeNodes)
        .where(inArray(scopeNodes.documentId, withScope))
        .orderBy(asc(scopeNodes.position))
    : [];

  const nodesFor = (documentId: string) =>
    nodes.filter((node) => node.documentId === documentId);

  const out = rows.map(({ document, quote, contract, changeOrder, invoice }) => {
    const base = {
      id: document.id,
      jobId: document.jobId,
      number: document.number,
    };

    switch (document.type) {
      case "quote": {
        const own = nodesFor(document.id);
        return {
          ...base,
          kind: "quote" as const,
          // Sent: where it stands (sent, opened, approved). Draft: the editor.
          href: document.sentAt ? `/quotes/${document.id}/sent` : `/quotes/${document.id}`,
          documentType: "Quote",
          title: document.title,
          at: document.sentAt ?? document.createdAt,
          status: document.status,
          // **The canonical arithmetic, not a fifth copy of it** — the tree is
          // rebuilt and `totals()` runs on it, tax included.
          totalCents: quoteTotal(quote?.taxRate ?? null, own),
          rows: previewRowsFrom(own, 4),
        };
      }

      case "contract":
        return {
          ...base,
          kind: "contract" as const,
          href: `/jobs/${document.jobId}/contract`,
          documentType: "Contract",
          title: document.title ?? "The agreed scope",
          // Generated at acceptance, so its creation *is* the moment.
          at: document.createdAt,
          status:
            document.status === "signed"
              ? "signed"
              : document.status === "part_signed"
                ? "awaiting signature"
                : "generated",
          totalCents: contract?.contractSumCents ?? 0,
          rows: prose(document.summary, 4),
        };

      case "change_order":
        return {
          ...base,
          kind: "change_order" as const,
          href: `/jobs/${document.jobId}/change-orders/${document.id}`,
          documentType: "Change order",
          title: changeOrder?.whatChanged ?? document.title,
          at: document.sentAt ?? document.createdAt,
          status: document.status,
          totalCents: changeOrder?.deltaCents ?? 0,
          rows: previewRowsFrom(nodesFor(document.id), 4),
        };

      case "invoice":
        return {
          ...base,
          kind: "invoice" as const,
          href: `/invoices/${document.id}`,
          documentType: "Invoice",
          // One object, three moments — the type is what it is, so it is the
          // title.
          title: (invoice?.invoiceType ?? "invoice").replace(/_/g, " "),
          at: document.issuedAt ?? document.createdAt,
          status: document.status,
          totalCents: invoice?.amountDueCents ?? 0,
          rows: prose(invoice?.covers ?? null, 3),
        };
    }
  });

  // Oldest first: the job reads left to right, start to finish.
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** What a quote comes to, through the one implementation of that arithmetic. */
function quoteTotal(taxRate: string | null, rows: ScopeNodeRow[]): number {
  return totals(
    emptyDraft({
      scope: scopeTreeFromRows(rows),
      taxRate: taxRate === null ? null : Number(taxRate),
    })
  ).totalCents;
}

/**
 * A document whose content is sentences rather than rows.
 *
 * A Contract's opening paragraph and an Invoice's "what this covers" give the
 * thumbnail something real to show rather than one long truncated string.
 */
function prose(text: string | null, take: number): QuotePreviewRow[] {
  if (!text?.trim()) return [];

  return text
    .split(/\n+|(?<=\.)\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, take)
    .map((description) => ({ description, amountCents: 0, unpriced: true }));
}
