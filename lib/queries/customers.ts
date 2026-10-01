import { tagPredicate } from "./tags";
import type { TagFilter } from "@/lib/tags";
import "server-only";

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { customers, jobs } from "@/lib/db/schema";
import { collectedForCustomer } from "@/lib/ledger";
import { jobMoney, type JobMoney } from "@/lib/queries/jobs";

/**
 * The customer directory.
 *
 * Customer is deliberately thin: **a directory for finding jobs by person, not
 * a parallel hierarchy.** Documents reach a customer through the Job rather
 * than directly, which is what keeps the model a tree — and it is why job
 * count, open balance and last-job date are **derived here rather than stored
 * on the row**. Columns for those would need something to keep them accurate,
 * and the first time a payment or a change order slipped past that, the
 * directory would be quietly lying about someone's money.
 */

/**
 * Drizzle renders an embedded column **unqualified** inside a `sql` template in
 * a `.select()` projection — `${{table}}.id` becomes `"id"`, not
 * `"table"."id"`. Inside a correlated subquery whose own table also has an `id`
 * column that is ambiguous, and Postgres rejects it (42702). It qualifies
 * correctly in `orderBy`, which is what makes the failure so easy to miss.
 *
 * These constants are the explicit reference. Never interpolate a bare column
 * into a correlated subquery.
 */
const CUSTOMER_ID = sql.raw('"customers"."id"');

export type CustomerListItem = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  jobCount: number;
  /**
   * What they owe **right now**: invoiced and not paid.
   *
   * Deliberately not a job's `remaining`, which includes work that is agreed
   * but not yet billed. A contractor asking "what does she owe me" means the
   * bills he has actually sent — quoting the unbilled remainder back at a
   * customer is how an awkward phone call starts.
   *
   * Can be negative, and that is left visible: an overpayment is a real state
   * and hiding it behind a zero is how a credit goes unnoticed.
   */
  openBalanceCents: number;
  /** When their most recent job was opened. Null if they have none. */
  lastJobAt: Date | null;
  /** Made on the demo start — listed and labelled, never matched by name. */
  demo: boolean;
};

export async function listCustomers(
  organizationId: string,
  options?: TagFilter & { q?: string; limit?: number; offset?: number }
): Promise<CustomerListItem[]> {
  const scope = and(eq(customers.organizationId, organizationId), tagPredicate(organizationId, "customer", options));
  const term = options?.q ? `%${options.q}%` : null;

  return db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      address: customers.address,
      demo: customers.isDemo,
      jobCount: sql<number>`(
        select count(*)::int from jobs j where j.customer_id = ${CUSTOMER_ID}
      )`,
      lastJobAt: sql<Date | null>`(
        select max(j.created_at) from jobs j where j.customer_id = ${CUSTOMER_ID}
      )`,
      // Billed minus collected, across every job of theirs. Draft and voided
      // invoices are excluded because they are not money anyone owes.
      openBalanceCents: sql<number>`(
        coalesce((
          select sum(idt.amount_due_cents)
          from documents i
          join invoice_details idt on idt.document_id = i.id
          join jobs j on j.id = i.job_id
          where j.customer_id = ${CUSTOMER_ID}
            and i.type = 'invoice'
            and i.status not in ('draft', 'void')
            and idt.voided_at is null
        ), 0)
        - ${collectedForCustomer(CUSTOMER_ID)}
      )::int`,
    })
    .from(customers)
    .where(
      term
        ? and(
            scope,
            or(
              ilike(customers.name, term),
              ilike(customers.address, term),
              ilike(customers.email, term),
              ilike(customers.phone, term)
            )
          )
        : scope
    )
    // By recent work rather than alphabetically: a directory is opened to find
    // someone you are dealing with, not to read a phone book.
    .orderBy(
      desc(sql`(select max(j.created_at) from jobs j where j.customer_id = ${CUSTOMER_ID})`),
      desc(customers.createdAt)
    )
    .limit(options?.limit ?? 50)
    .offset(options?.offset ?? 0);
}

export type CustomerDetail = CustomerListItem & {
  notes: string | null;
  jobs: {
    id: string;
    number: number;
    name: string | null;
    address: string | null;
    status: (typeof jobs.status.enumValues)[number];
    createdAt: Date;
    money: JobMoney;
  }[];
};

/** One customer, with their jobs and each job's derived money. */
export async function getCustomer(
  customerId: string,
  organizationId: string
): Promise<CustomerDetail | null> {
  const [row] = await listCustomersById(customerId, organizationId);
  if (!row) return null;

  const theirJobs = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      name: jobs.name,
      address: jobs.address,
      status: jobs.status,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.customerId, customerId),
        eq(jobs.organizationId, organizationId)
      )
    )
    .orderBy(desc(jobs.createdAt));

  const money = await jobMoney(theirJobs.map((job) => job.id));

  return {
    ...row,
    jobs: theirJobs.map((job) => ({
      ...job,
      money: money.get(job.id) ?? {
        jobId: job.id,
        totalCents: 0,
        billedCents: 0,
        collectedCents: 0,
        spentCents: 0,
        remainingCents: 0,
      },
    })),
  };
}

/** The list query narrowed to one id, so both paths derive identically. */
async function listCustomersById(customerId: string, organizationId: string) {
  return db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      address: customers.address,
      notes: customers.notes,
      demo: customers.isDemo,
      jobCount: sql<number>`(
        select count(*)::int from jobs j where j.customer_id = ${CUSTOMER_ID}
      )`,
      lastJobAt: sql<Date | null>`(
        select max(j.created_at) from jobs j where j.customer_id = ${CUSTOMER_ID}
      )`,
      openBalanceCents: sql<number>`(
        coalesce((
          select sum(idt.amount_due_cents)
          from documents i
          join invoice_details idt on idt.document_id = i.id
          join jobs j on j.id = i.job_id
          where j.customer_id = ${CUSTOMER_ID}
            and i.type = 'invoice'
            and i.status not in ('draft', 'void')
            and idt.voided_at is null
        ), 0)
        - ${collectedForCustomer(CUSTOMER_ID)}
      )::int`,
    })
    .from(customers)
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.organizationId, organizationId)
      )
    )
    .limit(1);
}
