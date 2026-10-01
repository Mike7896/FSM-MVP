import { and, asc, eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson, readQuery } from "@/lib/api/handler";
import { ApiError, created, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { jobs, licenses, permits } from "@/lib/db/schema";
import { createPermitSchema, listPermitsSchema } from "@/lib/schemas";

/**
 * `/api/v1/permits`
 *
 * The product **tracks** permits; it does not **file** them. Filing means
 * integrating with a specific authority having jurisdiction, and there are tens
 * of thousands of them with no common interface. Everything here records what
 * the contractor did with the authority.
 *
 * There is deliberately no top-level permits *page* — a permit has no life
 * outside its job — but the endpoint is flat because a native client fetching
 * "every permit awaiting inspection" should not have to walk the jobs first.
 */

export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const query = readQuery(request, listPermitsSchema);

  const filters = [eq(jobs.organizationId, organizationId)];
  if (query.jobId) filters.push(eq(permits.jobId, query.jobId));
  if (query.status) filters.push(eq(permits.status, query.status));

  const rows = await db
    .select({ permit: permits, licenseNumber: licenses.number })
    .from(permits)
    .innerJoin(jobs, eq(permits.jobId, jobs.id))
    .leftJoin(licenses, eq(permits.licenseId, licenses.id))
    .where(and(...filters))
    .orderBy(asc(permits.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  return ok(
    rows.map((row) => ({ ...row.permit, licenseNumber: row.licenseNumber }))
  );
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, createPermitSchema);

  // The job id arrives from a client, so it is checked against this shop before
  // anything hangs off it. Drizzle bypasses RLS; this is that check.
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, body.jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);

  if (!job) throw new ApiError("not_found", "No job with that id in this shop.");

  // A License and a Permit meet at exactly one point — the jurisdiction — so a
  // license from another shop must never end up stamping this permit.
  if (body.licenseId) {
    const [license] = await db
      .select({ id: licenses.id })
      .from(licenses)
      .where(
        and(
          eq(licenses.id, body.licenseId),
          eq(licenses.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!license) {
      throw new ApiError("not_found", "No license with that id in this shop.");
    }
  }

  const [permit] = await db.insert(permits).values(body).returning();
  return created(permit, `/api/v1/permits/${permit.id}`);
});
