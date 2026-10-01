import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { readAccess } from "@/lib/membership/access";
import { resumeMembership } from "@/lib/membership/changes";

/**
 * `POST /api/v1/membership/resume` — undo a scheduled cancellation. The
 * existing renewal carries on; nothing new is charged (Billing §5.2).
 */
export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, { roles: BILLING_ROLES });
  await resumeMembership(organizationId, caller.userId);
  return ok(await readAccess(organizationId));
});
