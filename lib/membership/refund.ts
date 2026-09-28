import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { billingAccounts, billingEvents } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { stripe } from "@/lib/stripe/server";

import { readAccess } from "./access";
import { reconcileSubscription } from "./reconcile";

/**
 * THE 14-DAY GUARANTEE (§5.4).
 *
 * Within fourteen days of a shop's first paid purchase, it can have every
 * subscription payment from that window back and return to Free at once.
 * Once per business. Self-serve, because a guarantee that needs an email to
 * a person is a guarantee with a toll on it.
 *
 * Homeowner payments are a different flow entirely and are never touched: a
 * membership refund cannot refund a job payment (§8.3).
 */
export async function refundFirstPurchase(organizationId: string, actorUserId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}::text, 21))`);
    return refundLocked(organizationId, actorUserId);
  });
}

async function refundLocked(organizationId: string, actorUserId: string) {
  const now = new Date();
  const [account] = await db.select().from(billingAccounts)
    .where(eq(billingAccounts.organizationId, organizationId)).limit(1);
  if (account?.refundedAt) throw new DomainError("This business has already used its refund guarantee.", "conflict");
  const [started] = await db.select().from(billingEvents).where(and(
    eq(billingEvents.organizationId, organizationId), eq(billingEvents.kind, "guarantee.requested")
  )).limit(1);
  let request = started?.detail as { subscriptionId: string; from: number; until: number } | undefined;
  if (!request) {
    const access = await readAccess(organizationId, now);
    if (!access.refund.eligible || !access.subscriptionId || !access.refund.until || !account?.firstPaidAt) {
      throw new DomainError("The refund guarantee applies within 14 days of your first paid purchase, once per business.", "conflict");
    }
    request = {
      subscriptionId: access.subscriptionId,
      from: Math.floor((account.firstPaidAt.getTime() - 60_000) / 1000),
      until: Math.floor(now.getTime() / 1000),
    };
    // Persist intent before external effects; interrupted requests can resume
    // even after the eligibility window or subscription has ended.
    await db.insert(billingEvents).values({ organizationId, actorUserId, kind: "guarantee.requested", detail: request });
  }
  const refunded: { invoice: string; amount: number }[] = [];
  for await (const invoice of stripe().invoices.list({
    subscription: request.subscriptionId, status: "paid",
    created: { gte: request.from, lte: request.until }, limit: 100,
  })) {
    for await (const payment of stripe().invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 100 })) {
      const intent = payment.payment.payment_intent;
      const intentId = typeof intent === "string" ? intent : intent?.id;
      if (!intentId) continue;
      const prior = await stripe().refunds.list({ payment_intent: intentId, limit: 100 });
      const completed = prior.data.find((r) => r.metadata?.guarantee === "14_day" && r.status !== "failed" && r.status !== "canceled");
      const refund = completed ?? await stripe().refunds.create(
        { payment_intent: intentId, reason: "requested_by_customer", metadata: { organizationId, guarantee: "14_day" } },
        { idempotencyKey: `guarantee:${organizationId}:${intentId}` }
      );
      if (refund.status === "failed" || refund.status === "canceled") throw new DomainError("Stripe could not complete the refund. Please contact support.", "failed");
      refunded.push({ invoice: invoice.id, amount: refund.amount });
    }
  }
  const subscription = await stripe().subscriptions.retrieve(request.subscriptionId);
  if (subscription.status !== "canceled") {
    await stripe().subscriptions.cancel(request.subscriptionId, { prorate: false, invoice_now: false });
  }
  await reconcileSubscription(request.subscriptionId);
  // Mark consumed only after the money operation and cancellation succeed.
  await db.update(billingAccounts).set({ refundedAt: now, foundingStatus: "reversed", foundingHoldUntil: null, foundingHoldSession: null })
    .where(eq(billingAccounts.organizationId, organizationId));
  await db.insert(billingEvents).values({ organizationId, actorUserId, kind: "guarantee.refunded", detail: { refunded } });
  return { refundedCents: refunded.reduce((sum, row) => sum + row.amount, 0) };
}
