import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  packEntitlements,
  prices,
  products,
  stripeCustomers,
  subscriptions,
} from "@/lib/db/schema";
import { PACKS } from "@/lib/packs/catalog";
import { stripe } from "@/lib/stripe/server";

/** Statuses that should unlock paid features. */
const ENTITLED = ["trialing", "active"] as const;

/**
 * The organization's current subscription, if any.
 *
 * `organizationId` must come from the DAL - this function trusts it, because
 * Drizzle's connection bypasses RLS.
 */
export async function getSubscription(organizationId: string) {
  const [row] = await db
    .select({
      subscription: subscriptions,
      price: prices,
      product: products,
    })
    .from(subscriptions)
    .leftJoin(prices, eq(subscriptions.priceId, prices.id))
    .leftJoin(products, eq(prices.productId, products.id))
    .where(
      and(
        eq(subscriptions.organizationId, organizationId),
        inArray(subscriptions.status, [...ENTITLED, "past_due"])
      )
    )
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  return row ?? null;
}

/**
 * What the business pays us each month, plan plus every entitled pack.
 *
 * **One membership, priced additively** — the core subscription plus a monthly
 * amount per pack is a single charge with a visible breakdown, not separate
 * subscriptions (Object Model §5.1). This is the number the account menu shows
 * on its Account row, because a menu row that carries the answer saves the trip
 * the row exists to offer (wireframe 94 · 56c).
 *
 * Returns cents, or null when there is nothing to bill. Null is not zero: a
 * business on no paid plan has no monthly total, and "$0/mo" would read as a
 * claim about their plan rather than the absence of one.
 *
 * Written as one query rather than reusing `listPacks`, which fans out to three
 * and pulls the whole catalogue — this runs on every authenticated page render,
 * so it reads only the prices it is going to add up.
 */
export const getMonthlyTotalCents = cache(
  async (organizationId: string): Promise<number | null> => {
    const subscription = await getSubscription(organizationId);
    const planCents = subscription?.price?.unitAmount ?? null;
    if (planCents === null) return null;

    // Entitlement rows carry the pack slug; the catalogue maps a slug to the
    // Stripe price that charges for it. Going through the catalogue rather than
    // storing a price id on the entitlement is what lets a pack be repriced
    // without rewriting every shop's row.
    const entitled = await db
      .select({ packId: packEntitlements.packId })
      .from(packEntitlements)
      .where(
        and(
          eq(packEntitlements.organizationId, organizationId),
          isNull(packEntitlements.revokedAt)
        )
      );

    const lookupKeys = entitled
      .map(
        (row) => PACKS.find((pack) => pack.id === row.packId)?.stripePriceLookupKey
      )
      .filter((key): key is string => Boolean(key));

    if (lookupKeys.length === 0) return planCents;

    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${prices.unitAmount}), 0)` })
      .from(prices)
      .where(and(eq(prices.active, true), inArray(prices.id, lookupKeys)));

    return planCents + Number(row?.total ?? 0);
  }
);

/** True when the organization may use paid features. */
export async function hasActiveSubscription(organizationId: string) {
  const row = await getSubscription(organizationId);
  return row
    ? (ENTITLED as readonly string[]).includes(row.subscription.status)
    : false;
}

/** The plan catalogue for a pricing table, cheapest first. */
export async function getActivePlans() {
  return db
    .select({ price: prices, product: products })
    .from(prices)
    .innerJoin(products, eq(prices.productId, products.id))
    .where(and(eq(prices.active, true), eq(products.active, true)))
    .orderBy(asc(prices.unitAmount));
}

/**
 * What the shop has actually been charged.
 *
 * **Read from Stripe rather than mirrored into a table.** The billing tables
 * here are a read-model of what a *subscription* is, projected by the webhook
 * because the app reads it on every page load; an invoice history is opened
 * once a quarter and is exactly the kind of thing that goes stale in a mirror
 * nobody notices is broken. Stripe already stores it, already renders the PDF,
 * and is the only party that can say what was really collected.
 *
 * Returns an empty list rather than throwing when Stripe is unreachable or
 * unconfigured. A receipts list that fails is a missing section; a billing page
 * that 500s over it is a contractor who cannot see their plan or cancel.
 */
export type Receipt = {
  id: string;
  /** Unix seconds, from Stripe. */
  created: number;
  amountPaidCents: number;
  currency: string;
  status: string | null;
  /** Stripe-hosted PDF. Null on an invoice that has not finalised. */
  pdfUrl: string | null;
  hostedUrl: string | null;
};

export async function listReceipts(
  organizationId: string,
  limit = 6
): Promise<Receipt[]> {
  const [customer] = await db
    .select({ stripeCustomerId: stripeCustomers.stripeCustomerId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.organizationId, organizationId))
    .limit(1);

  // No Stripe customer means nothing has ever been charged — not an error.
  if (!customer) return [];

  try {
    const invoices = await stripe().invoices.list({
      customer: customer.stripeCustomerId,
      limit,
    });

    return invoices.data
      .filter((invoice) => invoice.amount_paid > 0)
      .map((invoice) => ({
        id: invoice.id ?? "",
        created: invoice.created,
        amountPaidCents: invoice.amount_paid,
        currency: invoice.currency,
        status: invoice.status,
        pdfUrl: invoice.invoice_pdf ?? null,
        hostedUrl: invoice.hosted_invoice_url ?? null,
      }));
  } catch (error) {
    console.error("[billing] couldn't load receipts from Stripe:", error);
    return [];
  }
}

/**
 * The card on file, for the one line the billing page states.
 *
 * Same reasoning as receipts: Stripe knows, and a mirrored last-four that goes
 * stale is worse than no last-four at all — it tells a contractor a charge will
 * land on a card they replaced.
 */
export type PaymentMethodSummary = {
  brand: string | null;
  last4: string | null;
  /** So a card about to lapse can be named before it does. */
  expMonth: number | null;
  expYear: number | null;
};

export async function getDefaultPaymentMethod(
  organizationId: string
): Promise<PaymentMethodSummary | null> {
  const [customer] = await db
    .select({ stripeCustomerId: stripeCustomers.stripeCustomerId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.organizationId, organizationId))
    .limit(1);

  if (!customer) return null;

  try {
    const record = await stripe().customers.retrieve(
      customer.stripeCustomerId,
      { expand: ["invoice_settings.default_payment_method"] }
    );

    if (record.deleted) return null;

    const method = record.invoice_settings?.default_payment_method;
    if (!method || typeof method === "string") return null;

    return {
      brand: method.card?.brand ?? null,
      last4: method.card?.last4 ?? null,
      expMonth: method.card?.exp_month ?? null,
      expYear: method.card?.exp_year ?? null,
    };
  } catch (error) {
    console.error("[billing] couldn't load the payment method:", error);
    return null;
  }
}
