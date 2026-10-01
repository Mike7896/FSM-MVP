import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { previewChange } from "@/lib/membership/changes";
import { membershipConfigSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/membership/preview` — what a change costs, before it happens.
 *
 * Due now (Stripe's own preview, at a fixed proration moment), what renews and
 * when, and what waits for the renewal (Billing §5.2). Changes nothing.
 */
export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const body = await readJson(request, membershipConfigSchema);
  const { organizationId } = await requireOrg(request, caller, { roles: BILLING_ROLES });
  return ok(await previewChange(organizationId, body));
});
