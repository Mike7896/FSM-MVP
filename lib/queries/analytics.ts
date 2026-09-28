import "server-only";

import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { COLLECTION_TYPES, documents, jobs, ledgerEntries } from "@/lib/db/schema";
import { listInvoices } from "@/lib/queries/invoices";

/**
 * BUSINESS ANALYTICS — the Pro set named in Billing §2.2: quote acceptance,
 * collected revenue, and aging balances.
 *
 * Every number is counted from the shop's own records — documents and the
 * ledger — and demo work is left out of all of it, the same as the
 * dashboard. Nothing here is estimated.
 */

const DAY = 86_400_000;

export type QuoteAcceptance = {
  windowDays: number;
  sent: number;
  accepted: number;
  declined: number;
  /** Accepted ÷ sent, 0–1. Null with nothing sent. */
  rate: number | null;
};

export async function quoteAcceptance(organizationId: string, windowDays = 90): Promise<QuoteAcceptance> {
  const since = new Date(Date.now() - windowDays * DAY);
  const [row] = await db
    .select({
      sent: sql<number>`count(*)::int`,
      accepted: sql<number>`count(*) filter (where ${documents.status} = 'accepted')::int`,
      declined: sql<number>`count(*) filter (where ${documents.status} = 'declined')::int`,
    })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.type, "quote"),
        eq(jobs.isDemo, false),
        isNotNull(documents.sentAt),
        gte(documents.sentAt, since)
      )
    );
  const sent = row?.sent ?? 0;
  return {
    windowDays,
    sent,
    accepted: row?.accepted ?? 0,
    declined: row?.declined ?? 0,
    rate: sent ? (row?.accepted ?? 0) / sent : null,
  };
}

export type MonthCollected = { month: string; label: string; cents: number };

/** Money collected per calendar month, oldest first — payments less refunds and chargebacks. */
export async function collectedByMonth(organizationId: string, months = 6): Promise<MonthCollected[]> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${ledgerEntries.occurredAt} at time zone 'UTC'), 'YYYY-MM')`,
      cents: sql<string>`coalesce(sum(${ledgerEntries.amountCents}), 0)::text`,
    })
    .from(ledgerEntries)
    .leftJoin(jobs, eq(ledgerEntries.jobId, jobs.id))
    .where(
      and(
        eq(ledgerEntries.organizationId, organizationId),
        inArray(ledgerEntries.entryType, [...COLLECTION_TYPES]),
        gte(ledgerEntries.occurredAt, start),
        // Money on a demo job is not money.
        sql`coalesce(${jobs.isDemo}, false) = false`
      )
    )
    .groupBy(sql`1`);

  const byMonth = new Map(rows.map((row) => [row.month, Number(row.cents)]));
  return Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const month = date.toISOString().slice(0, 7);
    return {
      month,
      label: date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      cents: byMonth.get(month) ?? 0,
    };
  });
}

export type AgingBucket = { label: string; count: number; cents: number };

/** What's owed, by how late it is. */
export async function agingBalances(organizationId: string): Promise<AgingBucket[]> {
  const invoices = await listInvoices(organizationId, { limit: 1000 });
  const buckets: AgingBucket[] = [
    { label: "Not due yet", count: 0, cents: 0 },
    { label: "1–30 days late", count: 0, cents: 0 },
    { label: "31–60 days late", count: 0, cents: 0 },
    { label: "61–90 days late", count: 0, cents: 0 },
    { label: "Over 90 days late", count: 0, cents: 0 },
  ];
  for (const invoice of invoices) {
    if (invoice.outstandingCents <= 0 || invoice.status === "draft" || invoice.effectiveStatus === "void") continue;
    const days = invoice.daysPastDue;
    const index = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    buckets[index].count += 1;
    buckets[index].cents += invoice.outstandingCents;
  }
  return buckets;
}
