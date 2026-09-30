import "server-only";


import { db } from "@/lib/db";
import { withOperationLock } from "@/lib/db/operation-lock";
import { billingEvents } from "@/lib/db/schema";
import { absoluteUrl } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { stripe } from "@/lib/stripe/server";
import { getOrCreateStripeCustomer } from "@/lib/stripe/sync";

import { readAccess } from "./access";
import {
  PACK_LABEL,
  POLICY,
  coreLookupKey,
  packLookupKey,
  type BillingInterval,
  type PackId,
  type PaidTier,
} from "./catalog";
import { attachFoundingHold, foundingOfferFor, holdFoundingSeat } from "./founding";
import { priceIdFor } from "./prices";
import { getReleases } from "./releases";
import { taxCalculationActive } from "./stripe-context";

/**
 * FREE → PAID (§5.2): one Checkout Session, one subscription, a core plan and
 * any packs on the same interval and renewal date.
 *
 * **Access follows payment.** Nothing here grants anything; the subscription
 * the session creates is reconciled from Stripe once it exists, and only its
 * paid state opens the plan.
 *
 * Prices are resolved here from lookup keys — a founding price only when the
 * server decided the shop qualifies, never because a client asked for it.
 */

export type CheckoutRequest = {
  organizationId: string;
  caller: { userId: string; email: string };
  tier: PaidTier;
  interval: BillingInterval;
  packs: PackId[];
  /** Where to land afterwards — an in-app path the caller has checked. */
  returnPath?: string;
};

export async function startMembershipCheckout(request: CheckoutRequest) {
  return withOperationLock(request.organizationId, 24, async () => {
    return startCheckoutLocked(request);
  });
}

async function startCheckoutLocked(request: CheckoutRequest) {
  const { organizationId, tier, interval } = request;
  const packs = [...new Set(request.packs)];
  const now = new Date();

  const [access, releases] = await Promise.all([readAccess(organizationId, now), getReleases()]);

  if (access.subscriptionId && access.standing !== "free" && access.standing !== "comp") {
    throw new DomainError(
      access.standing === "restricted" || access.standing === "grace"
        ? "Your last renewal hasn't been paid. Update your card in Billing first — nothing new can be bought until it settles."
        : "You already have a membership. Change it from Billing rather than starting a second one.",
      "conflict"
    );
  }

  if (tier === "pro" && !releases.pro) {
    throw new DomainError("Pro isn't available yet.", "conflict");
  }
  for (const pack of packs) {
    if (!releases[`pack_${pack}`]) {
      throw new DomainError(`The ${PACK_LABEL[pack]} pack isn't available yet.`, "conflict");
    }
  }

  // Founding prices, decided here (§6). A seat is held for the checkout.
  const offer = await foundingOfferFor(organizationId, now);
  let founding = offer.eligible;
  if (offer.eligible && !offer.retained) {
    founding = await holdFoundingSeat(organizationId, now);
    if (!founding) throw new DomainError("The founding offer has filled since you viewed it. Review the current price before continuing.", "conflict");
  }

  const customer = await getOrCreateStripeCustomer(organizationId, request.caller.email);
  // Only one payable Checkout page per shop. Expiration loses safely to a
  // completion race, and a fresh subscription read catches delayed webhooks.
  for await (const session of stripe().checkout.sessions.list({ customer, status: "open", limit: 100 })) {
    if (session.mode === "subscription") await stripe().checkout.sessions.expire(session.id);
  }
  for await (const subscription of stripe().subscriptions.list({ customer, status: "all", limit: 100 })) {
    if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
      throw new DomainError("A membership already exists or is awaiting payment. Open Billing to manage it.", "conflict");
    }
  }
  const [corePrice, ...packPrices] = await Promise.all([
    priceIdFor(coreLookupKey(tier, interval, founding)),
    ...packs.map((pack) => priceIdFor(packLookupKey(pack, interval))),
  ]);

  const tax = await taxCalculationActive();
  const back = request.returnPath ?? "/account/billing";

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [
      { price: corePrice, quantity: 1 },
      ...packPrices.map((price) => ({ price, quantity: 1 })),
    ],
    // MVL Software sells the membership itself, with Stripe Tax (§10.1, §11).
    // Stripe's Managed Payments — Stripe as merchant of record — is on by
    // default on new accounts, but it doesn't support Connect platforms or
    // subscriptions changed outside Checkout, both of which this app is.
    managed_payments: { enabled: false },
    // Card-funded automatic collection, wallets included (§5.1).
    payment_method_types: ["card"],
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    automatic_tax: { enabled: tax },
    tax_id_collection: { enabled: true },
    // Founding prices don't stack with promotions (§6).
    allow_promotion_codes: !founding,
    expires_at: Math.floor(now.getTime() / 1000) + POLICY.foundingHoldMinutes * 60,
    subscription_data: {
      metadata: { organizationId, founding: String(founding) },
      description: "ServiceClerk membership",
    },
    metadata: { organizationId, founding: String(founding) },
    success_url: absoluteUrl(
      `/account/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}&next=${encodeURIComponent(back)}`
    ),
    cancel_url: absoluteUrl(`/upgrade?checkout=cancelled`),
  });

  if (!session.url) throw new DomainError("Stripe did not return a checkout page.", "failed");

  if (founding && offer.eligible && !offer.retained) {
    await attachFoundingHold(organizationId, session.id);
  }

  await db.insert(billingEvents).values({
    organizationId,
    actorUserId: request.caller.userId,
    kind: "checkout.started",
    detail: { sessionId: session.id, tier, interval, packs, founding, tax },
  });

  return { url: session.url, founding };
}
