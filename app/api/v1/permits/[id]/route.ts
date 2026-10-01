import { and, eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, noContent, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { jobs, licenses, permits } from "@/lib/db/schema";
import { getPermit } from "@/lib/queries/permits";
import { updatePermitSchema } from "@/lib/schemas";

/** `/api/v1/permits/[id]` — scoped through the job that owns it. */

async function requirePermit(permitId: string, organizationId: string) {
  const [row] = await db
    .select({ id: permits.id, jobId: permits.jobId })
    .from(permits)
    .innerJoin(jobs, eq(permits.jobId, jobs.id))
    .where(
      and(eq(permits.id, permitId), eq(jobs.organizationId, organizationId))
    )
    .limit(1);

  if (!row) throw new ApiError("not_found", "No permit with that id in this shop.");
  return row;
}

export const GET = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  const permit = await getPermit(id, organizationId);
  if (!permit) {
    throw new ApiError("not_found", "No permit with that id in this shop.");
  }
  return ok(permit);
});

export const PATCH = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);
    await requirePermit(id, organizationId);
    const body = await readJson(request, updatePermitSchema);
    if (body.licenseId) {
      const [license] = await db.select({ id: licenses.id }).from(licenses)
        .where(and(eq(licenses.id, body.licenseId), eq(licenses.organizationId, organizationId))).limit(1);
      if (!license) throw new ApiError("invalid_request", "Choose a license from this business.");
    }

    const [updated] = await db
      .update(permits)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(permits.id, id))
      .returning();

    return ok(updated);
  }
);

/**
 * Inspections cascade with the permit, which is correct: an inspection has no
 * meaning once the authorization it was scheduled against is gone.
 */
export const DELETE = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);
    await requirePermit(id, organizationId);

    await db.delete(permits).where(eq(permits.id, id));
    return noContent();
  }
);
