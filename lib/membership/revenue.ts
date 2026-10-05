import "server-only";

import type Stripe from "stripe";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { platformInvoices, stripeCustomers } from "@/lib/db/schema";

/**
 * A paid membership invoice, kept for the admin dashboard's "collected" — the
 * cash that arrived, as opposed to MRR, the revenue promised each month.
 *
 * Idempotent on the invoice id, so a redelivered `invoice.paid` is one row.
 * The shop comes from the reconciled subscription, or failing that (a one-off
 * invoice) from the Stripe customer.
 */
export async function recordPlatformInvoice(invoice: Stripe.Invoice, organizationId: string | null) {
  if (!invoice.id || invoice.amount_paid <= 0) return;

  let shop = organizationId;
  if (!shop) {
    const customer = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (customer) {
      const [row] = await db
        .select({ organizationId: stripeCustomers.organizationId })
        .from(stripeCustomers)
        .where(eq(stripeCustomers.stripeCustomerId, customer))
        .limit(1);
      shop = row?.organizationId ?? null;
    }
  }

  const paidAt = invoice.status_transitions?.paid_at;
  await db
    .insert(platformInvoices)
    .values({
      id: invoice.id,
      organizationId: shop,
      amountPaidCents: invoice.amount_paid,
      currency: invoice.currency,
      billingReason: invoice.billing_reason ?? null,
      paidAt: paidAt ? new Date(paidAt * 1000) : new Date(),
    })
    .onConflictDoNothing();
}
