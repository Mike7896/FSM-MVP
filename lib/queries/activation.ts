import "server-only";

import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { customers, documents, jobs } from "@/lib/db/schema";
import { quoteTotalExpression } from "./scope-sql";

/**
 * Where a contractor is in getting started — what `/welcome` and the dashboard
 * read to decide which start, and which empty state, to draw.
 *
 * **Real work and the demo are counted apart**, because the question these
 * answer — has he sent anything yet? — is about real quotes only. A demo sent to
 * himself is practice, so the tour stays resumable until a real one goes.
 *
 * Takes an `organizationId` the caller has already proved.
 */

const DOCUMENT_ID = sql.raw('"documents"."id"');

export type StartState = {
  /** Real quotes that have gone out, ever. */
  realSent: number;
  /** Real quotes of any status. */
  realQuotes: number;
  /** The newest real draft — where a returning contractor is sent straight to. */
  realDraft: { id: string } | null;
  /** The newest demo quote, if he built one. */
  demoQuote: {
    id: string;
    title: string | null;
    customerName: string;
    status: string;
    totalCents: number;
    /** ISO strings — these cross to Client Components. */
    sentAt: string | null;
    createdAt: string;
  } | null;
};

export async function getStartState(
  organizationId: string
): Promise<StartState> {
  const quotesOf = (demo: boolean) =>
    and(
      eq(documents.organizationId, organizationId),
      eq(documents.type, "quote"),
      eq(jobs.isDemo, demo)
    );

  const [[sent], [all], [draft], [demo]] = await Promise.all([
    db
      .select({ value: count() })
      .from(documents)
      .innerJoin(jobs, eq(documents.jobId, jobs.id))
      .where(and(quotesOf(false), isNotNull(documents.sentAt))),
    db
      .select({ value: count() })
      .from(documents)
      .innerJoin(jobs, eq(documents.jobId, jobs.id))
      .where(quotesOf(false)),
    db
      .select({ id: documents.id })
      .from(documents)
      .innerJoin(jobs, eq(documents.jobId, jobs.id))
      .where(and(quotesOf(false), eq(documents.status, "draft")))
      .orderBy(desc(documents.updatedAt))
      .limit(1),
    db
      .select({
        id: documents.id,
        title: documents.title,
        status: documents.status,
        sentAt: documents.sentAt,
        createdAt: documents.createdAt,
        customerName: customers.name,
        totalCents: sql<string>`${quoteTotalExpression(DOCUMENT_ID)}::text`,
      })
      .from(documents)
      .innerJoin(jobs, eq(documents.jobId, jobs.id))
      .innerJoin(customers, eq(jobs.customerId, customers.id))
      .where(quotesOf(true))
      .orderBy(desc(documents.createdAt))
      .limit(1),
  ]);

  return {
    realSent: Number(sent?.value ?? 0),
    realQuotes: Number(all?.value ?? 0),
    realDraft: draft ? { id: draft.id } : null,
    demoQuote: demo
      ? {
          id: demo.id,
          title: demo.title,
          customerName: demo.customerName,
          status: demo.status,
          totalCents: Number(demo.totalCents),
          sentAt: demo.sentAt?.toISOString() ?? null,
          createdAt: demo.createdAt.toISOString(),
        }
      : null,
  };
}
