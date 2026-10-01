import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

import { isMutable, type DocumentType } from "./lifecycle";
import type { AnyDocument } from "./types";

/**
 * LOADING A DOCUMENT — Documents §12, item 3.
 *
 * **One round trip, whichever type it is.** The spine plus the right side
 * table plus scope plus options plus signatures, assembled here rather than by
 * five awaits in a page. Drizzle's relational query compiles this to a single
 * statement with lateral joins, which is the whole reason the relations are
 * declared on the schema.
 *
 * The type discrimination happens once, here. Everything downstream gets a
 * narrowed union and cannot read `amountDueCents` off a quote.
 *
 * `organizationId` must come from the DAL or `requireOrg` — every function
 * here trusts it, because Drizzle connects as a role that bypasses RLS and the
 * scoping *is* the authorization.
 *
 * Every read takes an optional `on`, so an operation that writes a document and
 * then reads it back does both inside one transaction. Without it, a caller
 * mid-transaction reads the state from *before* its own uncommitted writes —
 * which is the sort of bug that only appears once two operations are chained.
 */

/** `db`, or a transaction it handed out. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Executor = typeof db | any;

/** What every load pulls. One place, so no caller forgets the signatures. */
const WITH_EVERYTHING = {
  quote: true,
  contract: true,
  changeOrder: true,
  invoice: true,
  options: true,
  signatures: true,
  scope: {
    // Document order across the whole tree, which is exactly what the
    // contractor sees and what `buildScopeTree` expects.
    orderBy: (fields: { position: typeof documents.id }) => [asc(fields.position)],
  },
} as const;

export async function loadDocument(
  documentId: string,
  organizationId: string,
  on: Executor = db
): Promise<AnyDocument | null> {
  const row = await on.query.documents.findFirst({
    where: and(
      eq(documents.id, documentId),
      eq(documents.organizationId, organizationId)
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    with: WITH_EVERYTHING as any,
  });

  return row ? compose(row) : null;
}

/**
 * Every document on a job, newest first within each type.
 *
 * The Job hub's quiet rows at the foot, and the document half of the dispute
 * packet's timeline.
 */
export async function loadJobDocuments(
  jobId: string,
  organizationId: string,
  options?: { type?: DocumentType; on?: Executor }
): Promise<AnyDocument[]> {
  const rows = await (options?.on ?? db).query.documents.findMany({
    where: and(
      eq(documents.jobId, jobId),
      eq(documents.organizationId, organizationId),
      ...(options?.type ? [eq(documents.type, options.type)] : [])
    ),
    orderBy: [asc(documents.type), asc(documents.createdAt)],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    with: WITH_EVERYTHING as any,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => compose(row));
}

/** Whether this document may still be edited — the same answer the trigger gives. */
export function canEdit(document: AnyDocument): boolean {
  return (
    document.frozenAt === null && isMutable(document.type, document.status)
  );
}

/* ── Composition ──────────────────────────────────────────────────────── */

/**
 * Picks the one side table that belongs to this row's type.
 *
 * The relational query fetches all four because it cannot branch on a column;
 * exactly one is non-null, and which one is decided by `type`. Collapsing them
 * to a single `details` here is what makes the union discriminate properly
 * downstream — a consumer branches on `type` and gets the matching shape,
 * rather than four optional objects it has to null-check.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function compose(row: any): AnyDocument {
  const base = {
    id: row.id,
    organizationId: row.organizationId,
    jobId: row.jobId,
    customerId: row.customerId,
    number: row.number,
    status: row.status,
    sourceDocumentId: row.sourceDocumentId,
    title: row.title,
    summary: row.summary,
    termsText: row.termsText,
    header: row.header ?? {},
    packId: row.packId,
    issuedAt: row.issuedAt,
    sentAt: row.sentAt,
    viewedAt: row.viewedAt,
    frozenAt: row.frozenAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    scope: row.scope ?? [],
    options: row.options ?? [],
    signatures: row.signatures ?? [],
  };

  switch (row.type as DocumentType) {
    case "quote":
      return { ...base, type: "quote", details: row.quote ?? null };
    case "contract":
      return { ...base, type: "contract", details: row.contract ?? null };
    case "change_order":
      return {
        ...base,
        type: "change_order",
        details: row.changeOrder ?? null,
      };
    case "invoice":
      return { ...base, type: "invoice", details: row.invoice ?? null };
  }
}
