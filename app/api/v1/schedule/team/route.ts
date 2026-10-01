import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { listTeam } from "@/lib/schedule";

/** `GET /api/v1/schedule/team` — who can be put on a visit. */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  return ok(await listTeam(organizationId));
});
