import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { stripeCustomers } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe/server";

/**
 * What the shop has been charged and the card it's charged to — read from
 * Stripe directly. Plan state lives in `lib/membership`, which derives it
 * from the reconciled subscription (Billing §11.2).
 */

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

    // Checkout saves the card on the subscription rather than the customer,
    // so the membership's own card is what a renewal is charged to.
    let method = record.invoice_settings?.default_payment_method;
    if (!method) {
      const subscriptions = await stripe().subscriptions.list({
        customer: customer.stripeCustomerId,
        status: "all",
        limit: 1,
        expand: ["data.default_payment_method"],
      });
      method = subscriptions.data[0]?.default_payment_method ?? null;
    }
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
