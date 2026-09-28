import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { applyChange } from "@/lib/membership/changes";
import { membershipChangeSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/membership/change` — apply a previewed change.
 *
 * Takes the proration moment the preview used, so what is charged is what was
 * shown. Anything that costs more is granted only once it is paid; anything
 * that costs less waits for the renewal (Billing §5.2).
 */
export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const body = await readJson(request, membershipChangeSchema);
  const { organizationId } = await requireOrg(request, caller, { roles: BILLING_ROLES });
  return ok(
    await applyChange({
      organizationId,
      target: { tier: body.tier, interval: body.interval, packs: body.packs },
      prorationDate: body.prorationDate,
      actorUserId: caller.userId,
    })
  );
});
