import { tagPredicate } from "./tags";
import type { TagFilter } from "@/lib/tags";
import "server-only";

import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { customers, jobs, permits } from "@/lib/db/schema";
import { collectedForJob } from "@/lib/ledger";
import { jobStage, type JobStage } from "@/lib/billing/stage";
import { openGates, type Gate } from "@/lib/queries/gates";
import { listInvoices } from "@/lib/queries/invoices";

/**
 * The Job's money state, derived rather than stored.
 *
 * The Object Model is explicit that total, billed, collected, spent and
 * remaining are computed from a job's documents and payments. Storing them
 * would mean something has to keep them accurate, and the first time a change
 * order or an off-platform payment slipped past that, the Job hub would be
 * quietly lying about someone's money.
 *
 * Where each number comes from:
 * - **total** — the Contract's sum plus every *approved* change order. With no
 *   contract yet, the latest quote's Scope stands in, so a job still shows a
 *   number while it is being quoted.
 * - **billed** — invoices that have actually been issued. Drafts and voided
 *   invoices are not money anyone owes.
 * - **collected** — the ledger fold. Every kind of money that reached the
 *   contractor or left him again: card, ACH, cheque, cash, Venmo, Zelle, minus
 *   refunds and chargebacks. Payments recorded by hand are exactly equal to
 *   payments we processed.
 * - **spent** — receipts against the job.
 */
export type JobMoney = {
  jobId: string;
  totalCents: number;
  billedCents: number;
  collectedCents: number;
  spentCents: number;
  remainingCents: number;
};

export async function jobMoney(
  jobIds: string[],
  /** A transaction to read inside — the invoice write checks the cap in one. */
  on: Pick<typeof db, "execute"> = db
): Promise<Map<string, JobMoney>> {
  if (jobIds.length === 0) return new Map();

  const values = sql.join(
    jobIds.map((id) => sql`(${id}::uuid)`),
    sql`, `
  );

  const rows = await on.execute<{
    job_id: string;
    total_cents: string;
    billed_cents: string;
    collected_cents: string;
    spent_cents: string;
  }>(sql`
    -- RECURSIVE for the sake of the scope walk below. It applies to the whole
    -- WITH clause in Postgres; the non-recursive terms are unaffected.
    with recursive target(job_id) as (
      -- One placeholder per id, not an interpolated string: Drizzle flattens a
      -- JS array into separate positional parameters, so an explicit VALUES
      -- list keeps every id bound rather than concatenated.
      values ${values}
    ),
    contract_total as (
      -- The newest contract on each job, plus its approved amendments.
      select distinct on (c.job_id)
             c.job_id,
             cd.contract_sum_cents
               + coalesce((
                   select sum(cod.delta_cents)
                   from documents co
                   join change_order_details cod on cod.document_id = co.id
                   where cod.parent_contract_id = c.id and co.status = 'approved'
                 ), 0) as cents
      from documents c
      join contract_details cd on cd.document_id = c.id
      where c.type = 'contract' and c.job_id in (select job_id from target)
      order by c.job_id, c.created_at desc
    ),
    scope as (
      -- The Scope tree, walked, with optional-ness pushed down from every
      -- ancestor. lib/queries/scope-sql.ts and lib/quote/totals.ts written
      -- again, and the three have to agree: only priced leaves carry money,
      -- optional rows are not in the price, and tax lands on taxable non-labor
      -- rows. Inlined because a recursive CTE cannot be composed into an
      -- existing WITH chain from a fragment.
      select n.id, n.document_id, n.node_type, n.section, n.quantity,
             n.sell_price_cents, n.taxable, n.optional
      from scope_nodes n
      join documents q on q.id = n.document_id
      where q.type = 'quote'
        and q.job_id in (select job_id from target)
        and n.parent_node_id is null

      union all

      select child.id, child.document_id, child.node_type, child.section,
             child.quantity, child.sell_price_cents, child.taxable,
             (child.optional or parent.optional)
      from scope_nodes child
      join scope parent on child.parent_node_id = parent.id
    ),
    quote_total as (
      -- Fallback while the job is still being quoted: the most recent quote.
      select distinct on (q.job_id)
             q.job_id,
             coalesce(round(
               sum(s.quantity * s.sell_price_cents)
               + sum(s.quantity * s.sell_price_cents)
                 filter (where s.section <> 'labor' and s.taxable)
                 * coalesce(qd.tax_rate, 0)
             ), 0)::bigint as cents
      from documents q
      left join quote_details qd on qd.document_id = q.id
      left join scope s
        on s.document_id = q.id
       and s.node_type in ('item', 'allowance')
       and not s.optional
      where q.type = 'quote' and q.job_id in (select job_id from target)
      group by q.id, q.job_id, q.created_at, qd.tax_rate
      order by q.job_id, q.created_at desc
    )
    select
      t.job_id,
      coalesce(ct.cents, qt.cents, 0)::text as total_cents,
      coalesce((
        select sum(idt.amount_due_cents)
        from documents i
        join invoice_details idt on idt.document_id = i.id
        where i.job_id = t.job_id
          and i.type = 'invoice'
          and i.status not in ('draft', 'void')
          and idt.voided_at is null
      ), 0)::text as billed_cents,
      -- The ledger fold — lib/ledger/fold.ts, inlined for the same reason the
      -- scope walk is. Refunds and chargebacks are negative rows, so the sum
      -- nets them on its own.
      ${collectedForJob(sql.raw("t.job_id"))}::text as collected_cents,
      coalesce((
        select sum(r.amount_cents) from receipts r
        where r.job_id = t.job_id
      ), 0)::text as spent_cents
    from target t
    left join contract_total ct on ct.job_id = t.job_id
    left join quote_total qt on qt.job_id = t.job_id
  `);

  const out = new Map<string, JobMoney>();

  for (const row of rows) {
    const totalCents = Number(row.total_cents);
    const collectedCents = Number(row.collected_cents);
    out.set(row.job_id, {
      jobId: row.job_id,
      totalCents,
      billedCents: Number(row.billed_cents),
      collectedCents,
      spentCents: Number(row.spent_cents),
      remainingCents: totalCents - collectedCents,
    });
  }

  return out;
}

/* ── The job list ─────────────────────────────────────────────────────── */

/**
 * The Job list is **the only place a contractor browses a flat collection of
 * top-level things** — everything else in the product nests under a Job. So it
 * carries more per row than a list normally would: the money state, the permit
 * standing, and whether a gate has opened, because those are the three
 * questions that decide what he does next and none of them is on the Job row.
 *
 * Drizzle renders an embedded column **unqualified** inside a `sql` template in
 * a `.select()` projection, which is ambiguous in a correlated subquery; this is
 * the explicit reference.
 */
const JOB_ID = sql.raw('"jobs"."id"');

export type JobListItem = {
  id: string;
  number: number;
  name: string | null;
  address: string | null;
  status: (typeof jobs.status.enumValues)[number];
  /** Where it stands in words — the status, read with its invoices and money. */
  stage: JobStage;
  customerName: string;
  money: JobMoney;
  /** Set when a gate has opened recently — the triage band above the list. */
  gate: Gate | null;
  /** The standing of this job's permit, if it has one. */
  permitStatus: (typeof permits.status.enumValues)[number] | null;
  /** A demo job — listed and labelled, and never counted. */
  demo: boolean;
};

/**
 * Jobs still running — quoting, scheduled or in progress.
 *
 * What "open" means here is *not finished*: a complete or paid job needs
 * nothing more from anyone. Demo jobs are left out, the same as everywhere a
 * number is shown, because practice work is not work in flight.
 */
export async function countOpenJobs(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(jobs)
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        eq(jobs.isDemo, false),
        inArray(jobs.status, ["quoting", "scheduled", "in_progress"])
      )
    );
  return row?.count ?? 0;
}

export async function listJobs(
  organizationId: string,
  options?: TagFilter & {
    status?: (typeof jobs.status.enumValues)[number];
    customerId?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }
): Promise<JobListItem[]> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const filters = [eq(jobs.organizationId, organizationId)];
  filters.push(tagPredicate(organizationId, "job", options));
  if (options?.status) filters.push(eq(jobs.status, options.status));
  if (options?.customerId) filters.push(eq(jobs.customerId, options.customerId));
  if (options?.q) {
    const term = `%${options.q}%`;
    filters.push(
      or(
        ilike(customers.name, term),
        ilike(jobs.name, term),
        ilike(jobs.address, term)
      )!
    );
  }

  const rows = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      name: jobs.name,
      address: jobs.address,
      status: jobs.status,
      customerName: customers.name,
      demo: jobs.isDemo,
      // The most advanced permit on the job, because that is what governs
      // whether work can proceed.
      permitStatus: sql<
        (typeof permits.status.enumValues)[number] | null
      >`(
        select p.status from permits p
        where p.job_id = ${JOB_ID}
        order by case p.status
          when 'closed' then 6 when 'inspections_in_progress' then 5
          when 'issued' then 4 when 'applied' then 3
          when 'needed' then 2 when 'rejected' then 1 else 0 end desc
        limit 1
      )`,
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(...filters))
    // Most recently touched first. A job list ordered by number would put the
    // job he worked on this morning below one he closed in spring.
    .orderBy(desc(jobs.updatedAt))
    .limit(limit)
    .offset(offset);

  // Two extra round trips rather than one enormous join: the money query is
  // already written and correct, and gates are shared with the dashboard.
  const [money, gates, invoices] = await Promise.all([
    jobMoney(rows.map((row) => row.id)),
    openGates(organizationId),
    listInvoices(organizationId, {
      jobIds: rows.map((row) => row.id),
      limit: 1000,
    }),
  ]);

  return rows.map((row) => {
    const jobMoneyRow = money.get(row.id) ?? {
      jobId: row.id,
      totalCents: 0,
      billedCents: 0,
      collectedCents: 0,
      spentCents: 0,
      remainingCents: 0,
    };
    return {
      ...row,
      // The same words as the job's own page. The list doesn't read each
      // job's payment plan, so "every phase done" waits for the final bill.
      stage: jobStage({
        status: row.status,
        agreedCents: jobMoneyRow.totalCents,
        collectedCents: jobMoneyRow.collectedCents,
        invoices: invoices.filter((invoice) => invoice.jobId === row.id),
      }),
      money: jobMoneyRow,
      gate: gates.get(row.id) ?? null,
    };
  });
}

/* ── The materials budget ─────────────────────────────────────────────── */

/**
 * What the job's materials were actually priced at.
 *
 * The money view compares what has been spent against a budget, and that budget
 * has to be a **real number from the priced document** — the material rows on
 * the job's latest quote — not a fraction of the total. A convention like "35%
 * of the job" fires on a labour-heavy service call and stays silent on a
 * materials-heavy rewire, which is worse than showing nothing.
 *
 * Returns null when nothing has been priced yet, so the caller can say "no
 * budget to compare against" rather than compare against zero.
 */
export async function materialsBudget(jobId: string): Promise<number | null> {
  const rows = await db.execute<{ cents: string | null }>(sql`
    -- The same scope walk as the total above, narrowed to the material bucket.
    -- Containers carry no bucket so they fall out on their own; optional rows
    -- are excluded, and optional is inherited.
    with recursive quoted as (
      select q.id from documents q
      where q.job_id = ${jobId} and q.type = 'quote'
      order by q.created_at desc limit 1
    ),
    scope as (
      select n.id, n.section, n.quantity, n.sell_price_cents, n.optional
      from scope_nodes n
      where n.document_id in (select id from quoted) and n.parent_node_id is null

      union all

      select child.id, child.section, child.quantity, child.sell_price_cents,
             (child.optional or parent.optional)
      from scope_nodes child
      join scope parent on child.parent_node_id = parent.id
    )
    select round(sum(s.quantity * s.sell_price_cents))::text as cents
    from scope s
    where s.section = 'material' and not s.optional
  `);

  const cents = rows[0]?.cents;
  return cents === null || cents === undefined ? null : Number(cents);
}
