import { tagPredicate } from "./tags";
import type { TagFilter } from "@/lib/tags";
import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  documents,
  jobs,
  scopeNodes,
  type ScopeNode as ScopeNodeRow,
} from "@/lib/db/schema";
import { readQuoteRecord } from "@/lib/documents";
import {
  baseTotal,
  buildTree,
  isText,
  type QuoteDraft,
  type QuoteRecord,
  type ScopeNode,
} from "@/lib/quote";
import { quoteTotalExpression } from "./scope-sql";

/**
 * Reading quotes — screen-shaped reads over the document spine.
 *
 * **Every function here takes an `organizationId` the caller has already
 * proved.** Drizzle connects as a role that bypasses RLS, so an id arriving from
 * a client is an assertion until `requireOrg` or `requireMembership` has checked
 * it. Nothing here does that checking; it trusts its argument, which is only safe
 * because the argument can only come from one of those two helpers.
 *
 * Writes are not here. Creating, saving and sending a quote are operations in
 * `lib/documents`, where the rules live.
 */

/**
 * Drizzle renders an embedded column **unqualified** inside a `sql` template in
 * a `.select()` projection, which is ambiguous inside a correlated subquery
 * whose own table has an `id` too (42702). This is the explicit reference.
 */
const DOCUMENT_ID = sql.raw('"documents"."id"');

/** One quote, shaped for `draftFromRecord`. */
export async function getQuote(
  quoteId: string,
  organizationId: string
): Promise<QuoteRecord | null> {
  return readQuoteRecord(quoteId, organizationId);
}

/** The quotes list, with each total derived rather than stored. */
export async function listQuotes(
  organizationId: string,
  options: TagFilter & {
    status?: QuoteDraft["status"];
    jobId?: string;
    q?: string;
    limit: number;
    offset: number;
  }
) {
  const filters = [
    eq(documents.organizationId, organizationId),
    eq(documents.type, "quote"),
  ];
  filters.push(tagPredicate(organizationId, "quote", options));
  if (options.status) filters.push(eq(documents.status, options.status));
  if (options.jobId) filters.push(eq(documents.jobId, options.jobId));

  // Searching the row text as well as the title is the point of the list — it
  // is how a contractor finds the last time they priced similar work.
  if (options.q) {
    const term = `%${options.q}%`;
    filters.push(
      or(
        ilike(documents.title, term),
        ilike(customers.name, term),
        sql`exists (
          select 1 from scope_nodes sn
          where sn.document_id = ${DOCUMENT_ID} and sn.description ilike ${term}
        )`
      )!
    );
  }

  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      title: documents.title,
      status: documents.status,
      sentAt: documents.sentAt,
      viewedAt: documents.viewedAt,
      createdAt: documents.createdAt,
      jobId: documents.jobId,
      customerName: customers.name,
      // Listed and labelled, never hidden: he can hold a demo and real work at
      // the same time, and a list that quietly dropped one would lose it.
      demo: jobs.isDemo,
      // The one expression every list reads, so a quote cannot show one total
      // here and another on the job. Rules in `scope-sql.ts`.
      totalCents: sql<string>`${quoteTotalExpression(DOCUMENT_ID)}::text`,
    })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(...filters))
    .orderBy(desc(documents.createdAt))
    .limit(options.limit)
    .offset(options.offset);

  return rows.map((row) => ({
    ...row,
    status: row.status as QuoteDraft["status"],
    totalCents: Number(row.totalCents),
  }));
}

export type QuoteListItem = Awaited<ReturnType<typeof listQuotes>>[number];

/**
 * How many quotes this shop has **sent** in the current calendar month.
 *
 * The number the send limit counts, and the sentence the upgrade screen opens
 * with. Sent rather than created on purpose: building and editing are never
 * capped, and counting drafts would make the limit look like a cap on work.
 */
export async function sentThisMonth(organizationId: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.type, "quote"),
        // A demo goes to himself. It never counts toward what he can send.
        eq(jobs.isDemo, false),
        isNotNull(documents.sentAt),
        gte(documents.sentAt, startOfMonth)
      )
    );

  return Number(row?.count ?? 0);
}

/* ── Document previews ────────────────────────────────────────────────── */

/**
 * The first few lines of a document, as they read on the page.
 *
 * For the thumbnail on a list card — the miniature that makes a quote
 * recognisable at a glance rather than a row of text you have to read.
 */
export type QuotePreviewRow = {
  description: string;
  amountCents: number;
  /** Unpriced text — an exclusion or an assumption. Drawn without a number. */
  unpriced: boolean;
};

/**
 * Top-level Scope rows for a set of documents, in document order.
 *
 * **Every node is fetched and the trees rebuilt in TypeScript** rather than
 * rolled up in SQL. A group's subtotal has to agree with the same number in the
 * editor, the list total and her page, and there are already SQL
 * implementations of that arithmetic to keep in step — a fourth, written only for
 * a thumbnail, is the one most likely to drift and least likely to be noticed.
 */
export async function listQuotePreviews(
  documentIds: string[],
  perDocument = 4
): Promise<Map<string, QuotePreviewRow[]>> {
  const out = new Map<string, QuotePreviewRow[]>();
  if (documentIds.length === 0) return out;

  const rows = await db
    .select()
    .from(scopeNodes)
    .where(inArray(scopeNodes.documentId, documentIds))
    .orderBy(asc(scopeNodes.position), asc(scopeNodes.createdAt));

  const byDocument = new Map<string, ScopeNodeRow[]>();
  for (const row of rows) {
    const list = byDocument.get(row.documentId) ?? [];
    list.push(row);
    byDocument.set(row.documentId, list);
  }

  for (const documentId of documentIds) {
    out.set(
      documentId,
      previewRowsFrom(byDocument.get(documentId) ?? [], perDocument)
    );
  }

  return out;
}

/**
 * Stored Scope rows to the editor's tree — the same shape `draftFromRecord`
 * builds, for reads that never go through a quote record.
 */
export function scopeTreeFromRows(rows: ScopeNodeRow[]): ScopeNode[] {
  return buildTree(
    rows.map((row) => ({ ...row, parentId: row.parentNodeId })),
    (row) => ({
      key: row.id,
      id: row.id,
      type: row.nodeType,
      section: row.section,
      description: row.description,
      quantity: Number(row.quantity),
      unit: row.unit,
      unitCostCents: row.unitCostCents,
      markupPercent: row.markupBps === null ? null : row.markupBps / 100,
      sellPriceCents: row.sellPriceCents,
      taxable: row.taxable,
      optional: row.optional,
      breakdown: row.breakdown,
      source: row.source,
      children: [],
    })
  );
}

/**
 * Stored rows to the first few rows of the page they make up.
 *
 * Shared by the quotes shelf and the job hub's rail, and it works for a change
 * order's rows as readily as a quote's — one table, one tree, which is why a
 * change order can reuse the quote editor.
 */
export function previewRowsFrom(
  rows: ScopeNodeRow[],
  take: number
): QuotePreviewRow[] {
  return scopeTreeFromRows(rows)
    .slice(0, take)
    .map((node) => ({
      description: node.description,
      amountCents: baseTotal(node),
      unpriced: isText(node),
    }));
}
