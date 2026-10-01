import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { readAccess } from "@/lib/membership/access";
import { cancelMembership } from "@/lib/membership/changes";

/**
 * `POST /api/v1/membership/cancel` — Paid → Free at the end of the period,
 * packs and all, so no pack is ever left billing without a core (Billing §4.2,
 * §5.2). Undo with `/resume` any time before then.
 */
export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, { roles: BILLING_ROLES });
  await cancelMembership(organizationId, caller.userId);
  return ok(await readAccess(organizationId));
});
