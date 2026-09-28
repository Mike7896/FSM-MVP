import "server-only";

import type Stripe from "stripe";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  organizations,
  prices,
  products,
  stripeCustomers,
  subscriptions,
} from "@/lib/db/schema";
import { stripe, toDate } from "./server";

/**
 * Projects Stripe objects into our tables. Stripe is the source of truth;
 * these rows exist so the app can answer "is this org subscribed?" without a
 * round trip on every request.
 *
 * All writes are upserts keyed on the Stripe id, because webhooks can arrive
 * more than once and out of order.
 */

/**
 * Stripe types its enums as `'known' | (string & {})` so that a new API value
 * never breaks the SDK's types. Our columns are real Postgres enums, so those
 * values have to be narrowed deliberately rather than cast away.
 */

const PRICE_INTERVALS = ["day", "week", "month", "year"] as const;
type PriceInterval = (typeof PRICE_INTERVALS)[number];

function toInterval(value: string | null | undefined): PriceInterval | null {
  return PRICE_INTERVALS.includes(value as PriceInterval)
    ? (value as PriceInterval)
    : null;
}

const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;
type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

function toSubscriptionStatus(value: string): SubscriptionStatus {
  if (SUBSCRIPTION_STATUSES.includes(value as SubscriptionStatus)) {
    return value as SubscriptionStatus;
  }
  // Better to fail loudly and let Stripe retry than to record a billing state
  // we do not understand. Adding a status means a migration on the enum.
  throw new Error(
    `Unrecognized Stripe subscription status "${value}". ` +
      `Add it to the subscription_status enum before it can be stored.`
  );
}

export async function upsertProduct(product: Stripe.Product) {
  await db
    .insert(products)
    .values({
      id: product.id,
      active: product.active,
      name: product.name,
      description: product.description,
      image: product.images?.[0] ?? null,
      metadata: product.metadata,
    })
    .onConflictDoUpdate({
      target: products.id,
      set: {
        active: product.active,
        name: product.name,
        description: product.description,
        image: product.images?.[0] ?? null,
        metadata: product.metadata,
      },
    });
}

export async function upsertPrice(price: Stripe.Price) {
  const productId =
    typeof price.product === "string" ? price.product : price.product.id;

  // The price row has a foreign key to products, so make sure the parent
  // exists. A price webhook can legitimately arrive before its product.
  const existing = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (existing.length === 0) {
    if (typeof price.product !== "string" && !price.product.deleted) {
      await upsertProduct(price.product);
    } else {
      const fetched = await stripe().products.retrieve(productId);
      await upsertProduct(fetched);
    }
  }

  await db
    .insert(prices)
    .values({
      id: price.id,
      productId,
      active: price.active,
      currency: price.currency,
      unitAmount: price.unit_amount,
      interval: toInterval(price.recurring?.interval),
      intervalCount: price.recurring?.interval_count ?? null,
      trialPeriodDays: price.recurring?.trial_period_days ?? null,
      metadata: price.metadata,
    })
    .onConflictDoUpdate({
      target: prices.id,
      set: {
        productId,
        active: price.active,
        currency: price.currency,
        unitAmount: price.unit_amount,
        interval: toInterval(price.recurring?.interval),
        intervalCount: price.recurring?.interval_count ?? null,
        trialPeriodDays: price.recurring?.trial_period_days ?? null,
        metadata: price.metadata,
      },
    });
}

/** Resolves our organization id from a Stripe customer id. */
async function resolveOrganizationId(
  customerId: string
): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: stripeCustomers.organizationId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.stripeCustomerId, customerId))
    .limit(1);

  if (row) return row.organizationId;

  // Fallback for a customer created outside this app (e.g. in the Dashboard):
  // recover the link from metadata we set at creation time.
  const customer = await stripe().customers.retrieve(customerId);
  if (customer.deleted) return null;

  const organizationId = customer.metadata?.organizationId;
  if (!organizationId) return null;

  await db
    .insert(stripeCustomers)
    .values({ organizationId, stripeCustomerId: customerId })
    .onConflictDoNothing();

  return organizationId;
}

export async function upsertSubscription(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const organizationId = await resolveOrganizationId(customerId);
  if (!organizationId) {
    throw new Error(
      `No organization mapped to Stripe customer ${customerId}; ` +
        `refusing to write subscription ${subscription.id}.`
    );
  }

  // As of API version 2026-07-29.dahlia the billing period lives on the
  // subscription *item*, not the subscription. Reading
  // `subscription.current_period_end` here would silently produce null.
  const item = subscription.items.data[0];
  const price = item?.price;

  if (price) {
    await upsertPrice(price);
  }

  const values = {
    id: subscription.id,
    organizationId,
    status: toSubscriptionStatus(subscription.status),
    priceId: price?.id ?? null,
    quantity: item?.quantity ?? null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodStart: toDate(item?.current_period_start),
    currentPeriodEnd: toDate(item?.current_period_end),
    cancelAt: toDate(subscription.cancel_at),
    canceledAt: toDate(subscription.canceled_at),
    endedAt: toDate(subscription.ended_at),
    trialStart: toDate(subscription.trial_start),
    trialEnd: toDate(subscription.trial_end),
    metadata: subscription.metadata,
    updatedAt: new Date(),
  } satisfies typeof subscriptions.$inferInsert;

  await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: subscriptions.id, set: values });
}

export async function deleteSubscription(subscriptionId: string) {
  await db
    .update(subscriptions)
    .set({ status: "canceled", endedAt: new Date(), updatedAt: new Date() })
    .where(eq(subscriptions.id, subscriptionId));
}

/**
 * Returns the Stripe customer for an organization, creating it on first use.
 * The organization id is written into customer metadata so the mapping can be
 * rebuilt from Stripe alone if our row is ever lost.
 */
export async function getOrCreateStripeCustomer(
  organizationId: string,
  email: string
): Promise<string> {
  const [existing] = await db
    .select({ stripeCustomerId: stripeCustomers.stripeCustomerId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.organizationId, organizationId))
    .limit(1);

  if (existing) return existing.stripeCustomerId;

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const customer = await stripe().customers.create({
    email,
    name: org?.name,
    metadata: { organizationId },
  });

  await db
    .insert(stripeCustomers)
    .values({ organizationId, stripeCustomerId: customer.id })
    .onConflictDoNothing();

  return customer.id;
}
