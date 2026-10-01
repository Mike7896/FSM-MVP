import { and, eq } from "drizzle-orm";
import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { inspections, jobs } from "@/lib/db/schema";
import { notifyLater } from "@/lib/notifications";
import { updateInspectionSchema, validateInspectionResult } from "@/lib/schemas/permit";

export const PATCH = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, updateInspectionSchema);
  const { saved, before } = await db.transaction(async tx => {
    const [row] = await tx.select({ inspection: inspections }).from(inspections).innerJoin(jobs, eq(inspections.jobId, jobs.id))
      .where(and(eq(inspections.id, id), eq(jobs.organizationId, organizationId))).for("update", { of: inspections });
    if (!row) throw new ApiError("not_found", "That inspection doesn't exist.");
    const next = { ...row.inspection, ...body };
    const error = validateInspectionResult(next);
    if (error) throw new ApiError("invalid_request", error);
    const [saved] = await tx.update(inspections).set({ ...body, updatedAt: new Date() }).where(eq(inspections.id, id)).returning();
    return { saved, before: row.inspection.result };
  });

  // A result landing is news to the rest of the shop — never to the person who
  // just recorded it, which `notify` handles by leaving the actor out.
  if (saved.result !== before && (saved.result === "passed" || saved.result === "failed")) {
    notifyLater({ kind: "inspection.result", organizationId, inspectionId: saved.id, actorUserId: caller.userId });
  }

  return ok(saved);
});
