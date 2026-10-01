import "server-only";

import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { customers, documents, jobs, tasks } from "@/lib/db/schema";
import {
  SEARCH_KINDS,
  type SearchHit,
  type SearchKind,
  type SearchPage,
} from "@/lib/search/kinds";
import { formatMoney } from "@/lib/quote";
import { quoteTotalExpression } from "@/lib/queries/scope-sql";
import { statusLabel, taskKey } from "@/lib/tasks/types";

/**
 * One search across everything the shop has.
 *
 * **A contractor searches for a person or a place, not for an object type.**
 * "Petersen" is a customer, two jobs, a quote and an unpaid invoice, and
 * making somebody pick which list to look in first is making them do the
 * product's job. So one box searches all of it and the results arrive grouped,
 * because grouping is what makes a long list readable — not a filter they have
 * to set.
 *
 * **Grouped, and paged per group.** Each group asks for its own next page, so a
 * shop with two hundred Petersen invoices doesn't bury its one Petersen
 * customer. That is why this takes a `kind` and answers one group at a time
 * rather than returning a fixed slice of everything.
 *
 * Matching is a plain case-insensitive substring on the handful of fields
 * somebody actually types: a name, a number, an address, the words on a
 * document. Ranked by recency, because the thing you are looking for is nearly
 * always the thing you touched last.
 */

// The kinds, their labels and the row shapes live in `lib/search/kinds.ts`,
// which has no server imports — the header's modal reads the same list.
export {
  SEARCH_KINDS,
  KIND_LABELS,
  type SearchHit,
  type SearchKind,
  type SearchPage,
} from "@/lib/search/kinds";

/** Everything a document type needs that isn't shared. */
const DOCUMENT_KINDS = {
  quotes: { type: "quote", href: (id: string) => `/quotes/${id}` },
  contracts: {
    type: "contract",
    href: (_id: string, jobId: string) => `/jobs/${jobId}/contract`,
  },
  "change-orders": {
    type: "change_order",
    href: (id: string, jobId: string) => `/jobs/${jobId}/change-orders/${id}`,
  },
  invoices: { type: "invoice", href: (id: string) => `/invoices/${id}` },
} as const;

function like(term: string): string {
  // Escape what LIKE treats as wildcards, so a search for "50%" is a search
  // for "50%" rather than for everything.
  return `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export async function searchKind(
  organizationId: string,
  kind: SearchKind,
  query: string,
  { limit = 5, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<SearchPage> {
  const term = query.trim();
  if (term.length === 0) return { kind, hits: [], hasMore: false, offset };

  // One more than asked for: whether it comes back is the answer to "is there
  // another page", without a second count query.
  const rows = await (kind === "customers"
    ? searchCustomers(organizationId, term, limit + 1, offset)
    : kind === "jobs"
      ? searchJobs(organizationId, term, limit + 1, offset)
      : kind === "tasks"
        ? searchTasks(organizationId, term, limit + 1, offset)
        : searchDocuments(organizationId, kind, term, limit + 1, offset));

  return {
    kind,
    hits: rows.slice(0, limit),
    hasMore: rows.length > limit,
    offset,
  };
}

async function searchCustomers(
  organizationId: string,
  term: string,
  limit: number,
  offset: number
): Promise<SearchHit[]> {
  const match = like(term);

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      address: customers.address,
      demo: customers.isDemo,
      jobCount: sql<number>`(
        select count(*)::int from jobs j where j.customer_id = ${customers.id}
      )`,
    })
    .from(customers)
    .where(
      and(
        eq(customers.organizationId, organizationId),
        or(
          ilike(customers.name, match),
          ilike(customers.email, match),
          ilike(customers.phone, match),
          ilike(customers.address, match)
        )
      )
    )
    // **The id is the tiebreaker, and it is load-bearing.** Offset paging over
    // rows that share a sort key can hand the same row to two pages and skip
    // another — which is exactly what a bulk import produces, since every row
    // it writes carries the same timestamp.
    .orderBy(desc(customers.updatedAt), desc(customers.id))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    id: row.id,
    kind: "customers" as const,
    title: row.name,
    detail: [row.email, row.phone, row.address].filter(Boolean)[0] ?? null,
    meta:
      row.jobCount > 0
        ? `${row.jobCount} job${row.jobCount === 1 ? "" : "s"}`
        : null,
    href: `/customers/${row.id}`,
    demo: row.demo,
  }));
}

async function searchJobs(
  organizationId: string,
  term: string,
  limit: number,
  offset: number
): Promise<SearchHit[]> {
  const match = like(term);

  const rows = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      name: jobs.name,
      address: jobs.address,
      status: jobs.status,
      customerName: customers.name,
      demo: jobs.isDemo,
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        or(
          ilike(jobs.name, match),
          ilike(jobs.address, match),
          ilike(customers.name, match),
          // The number people read off a document — "#14" and "14" both find it.
          ilike(sql`'#' || ${jobs.number}::text`, match)
        )
      )
    )
    .orderBy(desc(jobs.updatedAt), desc(jobs.id))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    id: row.id,
    kind: "jobs" as const,
    title: [row.customerName, row.name].filter(Boolean).join(" — "),
    detail: row.address ?? `Job #${row.number}`,
    meta: row.status.replace(/_/g, " "),
    href: `/jobs/${row.id}`,
    demo: row.demo,
  }));
}

async function searchTasks(
  organizationId: string,
  term: string,
  limit: number,
  offset: number
): Promise<SearchHit[]> {
  const match = like(term);

  const rows = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      jobName: jobs.name,
      customerName: customers.name,
      demo: jobs.isDemo,
    })
    .from(tasks)
    .leftJoin(jobs, eq(tasks.jobId, jobs.id))
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(tasks.organizationId, organizationId),
        or(
          ilike(tasks.title, match),
          ilike(tasks.description, match),
          ilike(customers.name, match),
          ilike(jobs.name, match),
          // The key people read off the board — "T-14" and "14" both find it.
          ilike(sql`'T-' || ${tasks.number}::text`, match)
        )
      )
    )
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    id: row.id,
    kind: "tasks" as const,
    title: row.title,
    detail:
      [taskKey(row.number), [row.customerName, row.jobName].filter(Boolean).join(" — ")]
        .filter(Boolean)
        .join(" · ") || null,
    meta: statusLabel(row.status),
    href: `/tasks?task=${row.id}`,
    demo: row.demo ?? false,
  }));
}

async function searchDocuments(
  organizationId: string,
  kind: Exclude<SearchKind, "customers" | "jobs" | "tasks">,
  term: string,
  limit: number,
  offset: number
): Promise<SearchHit[]> {
  const spec = DOCUMENT_KINDS[kind];
  const match = like(term);

  const money: SQL<number | null> =
    kind === "quotes"
      ? sql`${quoteTotalExpression(sql.raw('"documents"."id"'))}`
      : sql`null::bigint`;

  const rows = await db
    .select({
      id: documents.id,
      jobId: documents.jobId,
      number: documents.number,
      title: documents.title,
      status: documents.status,
      customerName: customers.name,
      jobName: jobs.name,
      demo: jobs.isDemo,
      totalCents: money,
    })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.type, spec.type),
        or(
          ilike(documents.number, match),
          ilike(documents.title, match),
          ilike(documents.summary, match),
          ilike(customers.name, match),
          ilike(jobs.name, match)
        )
      )
    )
    .orderBy(desc(documents.updatedAt), desc(documents.id))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    id: row.id,
    kind,
    title: [row.number, row.customerName].filter(Boolean).join(" · "),
    detail: row.title || row.jobName || null,
    meta:
      row.totalCents != null
        ? formatMoney(Number(row.totalCents))
        : row.status.replace(/_/g, " "),
    href: spec.href(row.id, row.jobId),
    demo: row.demo,
  }));
}

/** The first page of every group, for the moment the box is first typed in. */
export function searchEverything(
  organizationId: string,
  query: string,
  limit = 5
): Promise<SearchPage[]> {
  return Promise.all(
    SEARCH_KINDS.map((kind) => searchKind(organizationId, kind, query, { limit }))
  );
}
