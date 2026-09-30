import "server-only";

import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { withOperationLock } from "@/lib/db/operation-lock";
import { ledgerEntries, paymentAttempts, type PaymentAttempt } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { recordEntry } from "@/lib/ledger";
import { withActivation } from "@/lib/membership/activation";
import { applicationFeeFor } from "@/lib/membership/catalog";
import { getReleases } from "@/lib/membership/releases";
import { resolvePayableInvoice } from "@/lib/queries/share";
import { formatMoney } from "@/lib/quote/money";

import { getConnectedAccount, railsFor } from "./connect";
import type { EventContext } from "./connect-events";
import { stripe } from "./server";

/**
 * COLLECTING A HOMEOWNER INVOICE ONLINE — Billing §8, §11.3.
 *
 * **The homeowner picks the rail first**, card or bank, and the PaymentIntent
 * is created for that rail alone. That is what lets ServiceClerk's fee be
 * decided on the server from trusted records: nothing on a card, 0.2% capped
 * at $5 on a successful ACH debit — and the homeowner pays the invoice amount
 * either way, the fee coming out of the contractor's proceeds.
 *
 * **Processing is not paid.** An ACH debit takes days and can fail; while it
 * is processing it holds the balance it covers, so a second attempt cannot
 * collect the same money twice, and the invoice says "processing" rather than
 * "paid". Only Stripe's `charge.succeeded` writes money into the ledger.
 *
 * Every attempt carries its own idempotency key and lives in
 * `payment_attempts`, which is also where the fee's refunds are counted — so
 * a refund event delivered twice returns the fee once.
 */

export type Rail = "card" | "ach";

export { railsFor };

/** Money already on its way for this invoice — reserved against a new attempt. */
export async function processingCentsFor(invoiceId: string): Promise<number> {
  const [row] = await db
    .select({ cents: sql<number>`coalesce(sum(${paymentAttempts.amountCents}), 0)::int` })
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.invoiceId, invoiceId), eq(paymentAttempts.status, "processing")));
  return row?.cents ?? 0;
}

export async function processingAttempts(invoiceId: string) {
  return db
    .select()
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.invoiceId, invoiceId), eq(paymentAttempts.status, "processing")));
}

export async function startPaymentAttempt(token: string, rail: Rail) {
  const initial = await resolvePayableInvoice(token);
  if (!initial) return null;
  // The lock coordinates all rails and is released automatically on a crash.
  // Attempts are persisted outside the lock transaction before calling Stripe,
  // so retries can recover the same idempotency key after a process failure.
  return withOperationLock(initial.invoiceId, 19, async () => {
    return withActivation({ organizationId: initial.organizationId, jobId: initial.jobId, action: "payment" },
      () => startLocked(token, rail));
  });
}

async function startLocked(token: string, rail: Rail) {
  const invoice = await resolvePayableInvoice(token);
  if (!invoice) throw new DomainError("This invoice is no longer payable.", "conflict");
  const business = invoice.businessName ?? "This business";
  const account = await getConnectedAccount(invoice.organizationId);
  if (!account?.chargesEnabled) {
    throw new DomainError(
      `${business} isn't set up to take online payments yet. Get in touch with them to arrange payment.`,
      "conflict"
    );
  }

  const rails = await railsFor(account.stripeAccountId);
  if (!rails[rail]) {
    throw new DomainError(
      rail === "ach"
        ? `${business} can't take bank payments yet. You can pay by card, or ask them about other ways to pay.`
        : `${business} can't take card payments yet. Get in touch with them to arrange payment.`,
      "conflict"
    );
  }

  const processing = await processingCentsFor(invoice.invoiceId);
  const amountCents = invoice.outstandingCents - processing;
  if (amountCents <= 0) {
    throw new DomainError(
      `A bank payment of ${formatMoney(processing)} is already on its way for this invoice. Nothing more is due while it clears.`,
      "conflict"
    );
  }

  const releases = await getReleases();
  const feeCents = rail === "ach" && releases.ach_application_fee ? applicationFeeFor("ach", amountCents) : 0;

  // Reconcile every live form, including another rail. A stale webhook must
  // never make a confirmed intent look like permission to collect again.
  const candidates = await db.select().from(paymentAttempts).where(and(
    eq(paymentAttempts.invoiceId, invoice.invoiceId),
    inArray(paymentAttempts.status, ["awaiting", "processing", "failed", "succeeded", "disputed"])
  ));
  let recoverable: PaymentAttempt | undefined;
  for (const previous of candidates) {
    if (previous.status === "disputed") {
      throw new DomainError("A disputed payment needs review before another payment can start. Please contact the business.", "conflict");
    }
    if (!previous.paymentIntentId) {
      if (Date.now() - previous.createdAt.getTime() >= 23 * 60 * 60 * 1000 ||
          previous.rail !== rail || previous.amountCents !== amountCents || previous.applicationFeeCents !== feeCents) {
        throw new DomainError("An earlier payment needs reconciliation before another can start. Please contact the business.", "conflict");
      }
      recoverable = previous;
      continue;
    }
    const intent = await stripe().paymentIntents.retrieve(previous.paymentIntentId, {}, { stripeAccount: account.stripeAccountId });
    if (intent.status === "succeeded") {
      const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
      const [posted] = chargeId ? await db.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(
        eq(ledgerEntries.organizationId, invoice.organizationId), eq(ledgerEntries.externalRef, chargeId),
        eq(ledgerEntries.source, "stripe")
      )).limit(1) : [];
      if (posted) continue;
    }
    if (["processing", "succeeded", "requires_capture"].includes(intent.status)) {
      throw new DomainError("A payment is already being confirmed for this invoice. Refresh the invoice before trying again.", "conflict");
    }
    if (intent.status !== "canceled" && previous.rail === rail && previous.amountCents === amountCents && previous.applicationFeeCents === feeCents && intent.client_secret) {
      return { invoice, account, attempt: previous, clientSecret: intent.client_secret, amountCents };
    }
    if (intent.status !== "canceled") {
      // If confirmation races cancellation, Stripe refuses this cancellation;
      // let that error stop this request rather than creating a second debit.
      await stripe().paymentIntents.cancel(intent.id, {}, { stripeAccount: account.stripeAccountId });
    }
    await db.update(paymentAttempts).set({ status: "canceled", updatedAt: new Date() }).where(eq(paymentAttempts.id, previous.id));
  }

  const idempotencyKey = recoverable?.idempotencyKey ?? `pay:${invoice.invoiceId}:${rail}:${amountCents}:${randomUUID()}`;
  const attempt = recoverable ?? (await db.insert(paymentAttempts).values({
    organizationId: invoice.organizationId,
    invoiceId: invoice.invoiceId,
    stripeAccountId: account.stripeAccountId,
    rail,
    amountCents,
    applicationFeeCents: feeCents,
    idempotencyKey,
  }).returning())[0];

  const intent = await stripe().paymentIntents.create(
    {
      amount: amountCents,
      currency: invoice.currency,
      // Zero is omitted, not sent: Stripe refuses a zero application fee (§8.2).
      ...(feeCents > 0 ? { application_fee_amount: feeCents } : {}),
      payment_method_types: [rail === "card" ? "card" : "us_bank_account"],
      ...(rail === "ach"
        ? { payment_method_options: { us_bank_account: { verification_method: "automatic" as const } } }
        : {}),
      metadata: {
        organizationId: invoice.organizationId,
        jobId: invoice.jobId,
        invoiceId: invoice.invoiceId,
        customerId: invoice.customerId,
        attemptId: attempt.id,
      },
      description: `Invoice from ${invoice.businessName ?? "your contractor"}`,
    },
    // A direct charge, on the contractor's own account (§8.1).
    { stripeAccount: account.stripeAccountId, idempotencyKey }
  );

  await db
    .update(paymentAttempts)
    .set({ paymentIntentId: intent.id, updatedAt: new Date() })
    .where(eq(paymentAttempts.id, attempt.id));

  if (!intent.client_secret) throw new DomainError("Stripe did not return a payment form.", "failed");

  return { invoice, account, attempt: { ...attempt, paymentIntentId: intent.id }, clientSecret: intent.client_secret, amountCents };
}

/* ── Stripe events on the connected account ───────────────────────────── */

async function attemptFor(paymentIntentId: string | null | undefined, context: EventContext) {
  if (!paymentIntentId) return null;
  const [row] = await db
    .select()
    .from(paymentAttempts)
    .where(
      and(
        eq(paymentAttempts.paymentIntentId, paymentIntentId),
        eq(paymentAttempts.organizationId, context.organizationId)
      )
    )
    .limit(1);
  return row ?? null;
}

const STATUS_FOR: Partial<Record<Stripe.PaymentIntent.Status, PaymentAttempt["status"]>> = {
  processing: "processing",
  succeeded: "succeeded",
  canceled: "canceled",
};

/** An intent moved. Settled states never move backwards on a late event. */
export async function onPaymentIntentEvent(
  intent: Stripe.PaymentIntent,
  context: EventContext
) {
  return withOperationLock(intent.id, 25, () => reconcileIntent(intent, context));
}

async function reconcileIntent(intent: Stripe.PaymentIntent, context: EventContext) {
  const attempt = await attemptFor(intent.id, context);
  if (!attempt) return;

  intent = await stripe().paymentIntents.retrieve(intent.id, {}, { stripeAccount: context.stripeAccountId });
  const failed = intent.status === "requires_payment_method" && Boolean(intent.last_payment_error);
  const next: PaymentAttempt["status"] | undefined = failed ? "failed" : STATUS_FOR[intent.status];
  if (!next) return;
  if (["succeeded", "refunded", "disputed"].includes(attempt.status) && next !== "succeeded") return;

  await db
    .update(paymentAttempts)
    .set({
      status: next,
      failureMessage: failed ? (intent.last_payment_error?.message ?? "The payment didn't go through.") : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(paymentAttempts.id, attempt.id),
        inArray(paymentAttempts.status, ["awaiting", "processing", "failed", "canceled"])
      )
    );
}

/**
 * The homeowner was refunded, in whole or in part, from anywhere — the app or
 * the contractor's own Stripe Dashboard. ServiceClerk hands back the matching
 * share of its ACH fee (§8.3): proportional to the principal refunded so far,
 * the whole fee once the whole payment is back, never more than it took, and
 * never twice for the same refund.
 */
export async function onAttemptRefunded(charge: Stripe.Charge, context: EventContext) {
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  const attempt = await attemptFor(intentId, context);
  if (!attempt) return;

  charge = await stripe().charges.retrieve(charge.id, {}, { stripeAccount: context.stripeAccountId });
  const refunded = Math.max(attempt.refundedCents, Math.min(charge.amount_refunded, attempt.amountCents));
  const full = refunded >= attempt.amountCents;
  await db
    .update(paymentAttempts)
    .set({
      refundedCents: sql`greatest(${paymentAttempts.refundedCents}, ${refunded})`,
      status: sql`case when greatest(${paymentAttempts.refundedCents}, ${refunded}) >= ${paymentAttempts.amountCents} then 'refunded' else ${paymentAttempts.status} end`,
      updatedAt: new Date(),
    })
    .where(eq(paymentAttempts.id, attempt.id));

  const target = full
    ? attempt.applicationFeeCents
    : Math.round((attempt.applicationFeeCents * refunded) / attempt.amountCents);
  await returnFee(charge, attempt, target, context);
}

/** An ACH debit returned or a dispute lost after success: the whole fee goes back (§8.3). */
export async function onAttemptReversed(charge: Stripe.Charge, context: EventContext) {
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  const attempt = await attemptFor(intentId, context);
  if (!attempt) return;
  await db
    .update(paymentAttempts)
    .set({ status: "disputed", updatedAt: new Date() })
    .where(eq(paymentAttempts.id, attempt.id));
  await returnFee(charge, attempt, attempt.applicationFeeCents, context);
}

async function returnFee(charge: Stripe.Charge, attempt: PaymentAttempt, target: number, context: EventContext) {
  const feeId = typeof charge.application_fee === "string" ? charge.application_fee : charge.application_fee?.id;
  if (!feeId) return;
  await withOperationLock(feeId, 20, async () => {
    const fee = await stripe().applicationFees.retrieve(feeId);
    const delta = Math.max(0, Math.min(target, fee.amount) - fee.amount_refunded);
    if (delta > 0) {
      await stripe().applicationFees.createRefund(feeId,
        { amount: delta, metadata: { attemptId: attempt.id } },
        { idempotencyKey: `fee-return:${attempt.id}:${fee.amount_refunded}:${target}` });
    }
    // Replay the actual refunds, even when Stripe already returned the entire
    // fee. This repairs a crash between the API call and either local write.
    let returned = 0;
    for await (const refund of stripe().applicationFees.listRefunds(feeId, { limit: 100 })) {
      await recordEntry({
        organizationId: context.organizationId, entryType: "application_fee",
        amountCents: refund.amount, currency: charge.currency,
        occurredAt: new Date(refund.created * 1000), source: "stripe",
        externalRef: refund.id, invoiceId: attempt.invoiceId,
        memo: "ServiceClerk ACH fee returned",
      });
      returned += refund.amount;
    }
    await db.update(paymentAttempts).set({ feeRefundedCents: returned, updatedAt: new Date() })
      .where(eq(paymentAttempts.id, attempt.id));
  });
}
