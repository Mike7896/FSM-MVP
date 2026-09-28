import { and, eq, sql } from "drizzle-orm";
import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson, readQuery } from "@/lib/api/handler";
import { ApiError, created, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { customers, jobs } from "@/lib/db/schema";
import { listJobs } from "@/lib/queries/jobs";
import { createJobSchema, listJobsSchema } from "@/lib/schemas";

/**
 * `/api/v1/jobs`
 *
 * The Job is the root of everything that happens around one piece of work, and
 * **the only prerequisite anywhere** — it is what every document create path
 * makes silently when there is nothing to hang a document on.
 *
 * Money comes back derived (see `lib/queries/jobs.ts`); there is nothing to
 * write for it, which is why the create body has no totals in it.
 */

export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const query = readQuery(request, listJobsSchema);

  // The same rows the web job list renders — money, permit standing and any
  // open gate included. A thinner payload here would mean the native app
  // deriving those itself, which is how two clients start disagreeing about
  // whether a job is cleared to start.
  return ok(await listJobs(organizationId, query));
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, createJobSchema);

  const job = await db.transaction(async (tx) => {
    let customerId: string;

    if (body.customerId) {
      // The customer id arrives from the client, so it is checked against this
      // organization before a job is hung off it. Drizzle bypasses RLS; this
      // is the check that stops a job being created against someone else's
      // customer.
      const [customer] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, body.customerId),
            eq(customers.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!customer) {
        throw new ApiError("not_found", "No customer with that id in this shop.");
      }
      customerId = customer.id;
    } else {
      // A typed name. The same person should not become two rows in his
      // directory, so an exact match (ignoring case) is used before a new row
      // is made — the rule a new quote follows. Practice customers never
      // match: real work does not land on the demo.
      const name = body.customerName!;
      const [match] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.organizationId, organizationId),
            eq(customers.isDemo, false),
            sql`lower(${customers.name}) = lower(${name})`
          )
        )
        .limit(1);

      if (match) {
        customerId = match.id;
      } else {
        const [row] = await tx
          .insert(customers)
          .values({ organizationId, name, address: body.address })
          .returning({ id: customers.id });
        customerId = row.id;
      }
    }

    const [row] = await tx
      .insert(jobs)
      .values({
        organizationId,
        customerId,
        name: body.name,
        description: body.description,
        address: body.address,
        jurisdiction: body.jurisdiction,
        packId: body.packId,
        startsOn: body.startsOn,
        endsOn: body.endsOn,
        createdBy: caller.userId,
        // `number` is assigned by the set_job_number trigger.
      })
      .returning();

    return row;
  });

  return created(job, `/api/v1/jobs/${job.id}`);
});
