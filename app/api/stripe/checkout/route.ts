import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { startMembershipCheckout } from "@/lib/membership/checkout";
import { membershipCheckoutSchema } from "@/lib/schemas";

/**
 * `POST /api/stripe/checkout` — Free → paid (Billing §5.2).
 *
 * The body names a **configuration** — tier, interval, packs — and never a
 * Stripe price id: which price that is, public or founding, is decided on the
 * server (§6, §11.1). Bearer-capable, so the native app can start checkout at
 * the moment the Free limit fires in a customer's kitchen.
 */
export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const body = await readJson(request, membershipCheckoutSchema);
  const { organizationId } = await requireOrg(request, caller, { roles: BILLING_ROLES });

  const result = await startMembershipCheckout({
    organizationId,
    caller: { userId: caller.userId, email: caller.email },
    tier: body.tier,
    interval: body.interval,
    packs: body.packs,
    returnPath: body.returnPath,
  });

  return ok(result);
});
