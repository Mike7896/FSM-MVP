import { z } from "zod";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { absoluteUrl } from "@/lib/env";
import { stripe } from "@/lib/stripe/server";
import { getOrCreateStripeCustomer } from "@/lib/stripe/sync";

/**
 * Creates a Checkout Session and returns its URL for the client to redirect to.
 *
 * Authenticates through `requireCaller`, so the native app can start checkout
 * with a bearer token rather than a cookie — the send limit fires in a
 * customer's kitchen, and a contractor who has to find a laptop to pay is a
 * contractor who does not pay.
 *
 * `requireOrg` re-checks the organization against the caller's memberships:
 * without it, a client could start a subscription on somebody else's shop.
 */

const bodySchema = z.object({
  priceId: z.string().min(1),
  /** Optional — falls back to the caller's only shop. */
  organizationId: z.uuid().optional(),
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const body = await readJson(request, bodySchema);

  const { organizationId } = await requireOrg(request, caller, {
    organizationId: body.organizationId,
    roles: ["owner", "admin"],
  });

  const customerId = await getOrCreateStripeCustomer(
    organizationId,
    caller.email
  );

  const checkout = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: body.priceId, quantity: 1 }],
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    success_url: absoluteUrl(
      "/account/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}"
    ),
    cancel_url: absoluteUrl("/account/billing?checkout=cancelled"),
    subscription_data: { metadata: { organizationId } },
    // Lets the webhook recover the org even if our customer row is missing.
    metadata: { organizationId },
  });

  if (!checkout.url) {
    throw new ApiError("internal", "Stripe did not return a checkout URL.");
  }

  return ok({ url: checkout.url });
});
