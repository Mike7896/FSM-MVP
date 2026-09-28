import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, noContent, ok } from "@/lib/api/response";
import { deleteVisit, getVisit, updateVisit } from "@/lib/schedule";
import { updateVisitSchema } from "@/lib/schemas";

/** `/api/v1/schedule/visits/[id]` — one visit: read it, change it, remove it. */

export const GET = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const visit = await getVisit(organizationId, id);
  if (!visit) throw new ApiError("not_found", "That visit isn't on the schedule.");
  return ok(visit);
});

/** A drag sends only the new times; the edit sheet sends what it changed. */
export const PATCH = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const change = await readJson(request, updateVisitSchema);
  return ok(await updateVisit(organizationId, caller.userId, id, change));
});

export const DELETE = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  await deleteVisit(organizationId, id);
  return noContent();
});
