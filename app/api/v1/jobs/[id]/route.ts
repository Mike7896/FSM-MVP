import { and, eq } from "drizzle-orm";
import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { customers, jobs } from "@/lib/db/schema";
import { getJobHub } from "@/lib/queries/job-hub";
import { updateJobSchema } from "@/lib/schemas";

/** `/api/v1/jobs/[id]` */

/**
 * Every read and write scopes by organization in the same query rather than
 * fetching first and checking after. A row that does not belong to the caller's
 * shop is simply not found, which also avoids leaking whether an id exists.
 */
async function findJob(jobId: string, organizationId: string) {
  const [row] = await db
    .select({ job: jobs, customerName: customers.name })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);

  if (!row) throw new ApiError("not_found", "No job with that id.");
  return row;
}

export const GET = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    // The whole hub, not a bare job row: money, the open gate, the draw
    // ledger, permits with their inspections, and the one next action. The
    // native app renders the same surface, and deriving "what should he do
    // next" separately on each client is how two of them start disagreeing
    // about whether a phase can be billed.
    const hub = await getJobHub(id, organizationId);
    if (!hub) throw new ApiError("not_found", "No job with that id.");

    return ok(hub);
  }
);

export const PATCH = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    await findJob(id, organizationId);
    const body = await readJson(request, updateJobSchema);

    const [job] = await db
      .update(jobs)
      .set(body)
      .where(and(eq(jobs.id, id), eq(jobs.organizationId, organizationId)))
      .returning();

    return ok(job);
  }
);
