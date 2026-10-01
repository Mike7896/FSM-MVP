import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readQuery } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { searchJobs } from "@/lib/schedule";
import { scheduleJobSearchSchema } from "@/lib/schemas";

/** `GET /api/v1/schedule/jobs?q=` — the visit sheet's job picker. */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const { q } = readQuery(request, scheduleJobSearchSchema);
  return ok(await searchJobs(organizationId, q));
});
