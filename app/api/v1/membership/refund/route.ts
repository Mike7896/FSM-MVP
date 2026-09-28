import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { refundFirstPurchase } from "@/lib/membership/refund";

/**
 * `POST /api/v1/membership/refund` — the 14-day guarantee (Billing §5.4).
 * Refunds the first window's subscription payments and returns the shop to
 * Free straight away. Once per business, and the owner's call alone.
 */
export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, { roles: ["owner"] });
  return ok(await refundFirstPurchase(organizationId, caller.userId));
});
