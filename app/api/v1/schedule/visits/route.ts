import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { created } from "@/lib/api/response";
import { createVisit } from "@/lib/schedule";
import { createVisitSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/schedule/visits` — book a visit. Answers with the visit and
 * any double-bookings it made, which are the page's to say, not a refusal.
 */
export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, createVisitSchema);

  const result = await createVisit(organizationId, caller.userId, body);
  return created(result, `/api/v1/schedule/visits/${result.visit.id}`);
});
