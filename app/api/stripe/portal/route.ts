import { z } from "zod";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { absoluteUrl } from "@/lib/env";
import { stripe } from "@/lib/stripe/server";
import { getOrCreateStripeCustomer } from "@/lib/stripe/sync";

/**
 * Opens the Stripe Billing Portal, where customers manage payment methods,
 * invoices and cancellation without us building any of it.
 *
 * Bearer-capable like the rest of the API, and gated on billing roles: a
 * technician should not be able to open the shop's payment settings.
 */

const bodySchema = z.object({
  organizationId: z.uuid().optional(),
  /**
   * The subscription to open the portal's **cancel** flow on.
   *
   * Cancelling happens on Stripe's own screen, with Stripe's own confirmation,
   * rather than in a button of ours that ends a subscription on one click. The
   * consequences page states what changes; this hands over to the system that
   * actually stops the charge.
   */
  cancelSubscriptionId: z.string().trim().min(1).optional(),
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const body = await readJson(request, bodySchema);

  const { organizationId } = await requireOrg(request, caller, {
    organizationId: body.organizationId,
    roles: ["owner", "admin"],
  });

  /**
   * A Stripe failure here is ours — a key, a portal that was never configured
   * — and the flat 500 the wrapper would produce says "that didn't save",
   * which is both wrong and alarming on a page about money. The contractor is
   * told plainly that nothing changed; the real reason goes to the log.
   */
  try {
    const customerId = await getOrCreateStripeCustomer(
      organizationId,
      caller.email
    );

    const portal = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: absoluteUrl("/account/billing"),
      ...(body.cancelSubscriptionId
        ? {
            flow_data: {
              type: "subscription_cancel" as const,
              subscription_cancel: { subscription: body.cancelSubscriptionId },
            },
          }
        : {}),
    });

    return ok({ url: portal.url });
  } catch (error) {
    console.error("[billing] couldn't open the Stripe portal:", error);
    throw new ApiError(
      "internal",
      "Stripe couldn't open the billing page just now. Nothing has changed, and nothing has been cancelled."
    );
  }
});
