import "server-only";

import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { connectedAccounts, documents, jobs } from "@/lib/db/schema";
import { recordEntry, type PaymentMethod } from "@/lib/ledger";
import { notifyLater } from "@/lib/notifications";
import { stripe } from "./server";

/**
 * STRIPE CONNECT EVENTS → LEDGER ROWS.
 *
 * The one place a Stripe event becomes money in this product's own record.
 * Everything here goes through `recordEntry`, which means everything here is
 * idempotent: Stripe delivers duplicates as ordinary operation, and a replay
 * has to be a no-op rather than a second payment.
 *
 * **Fees get their own rows.** A $2,000 card payment produces three entries —
 * the payment, Stripe's cut, and ours — because they are three separate
 * movements of money and netting them would lose the two the contractor's
 * accountant needs itemized. Only the first counts toward *collected*: the
 * homeowner paid $2,000, and what Stripe took afterwards does not change that.
 *
 * **Every id is a natural key.** `ch_...` for the payment, `ch_...:processing`
 * for the fee, `di_...` for a dispute. Derived rather than random, so the same
 * event redelivered a week later collides with the row it already wrote.
 */

/** Stripe's payment method type, in our vocabulary. */
function methodOf(charge: Stripe.Charge): PaymentMethod {
  switch (charge.payment_method_details?.type) {
    case "card":
    case "card_present":
      return "card";
    case "us_bank_account":
    case "acss_debit":
      return "ach";
    default:
      // Cash App, Link, anything Stripe adds next. `other` is honest; guessing
      // is not, and the method is what an accountant reconciles on.
      return "other";
  }
}

/** Stripe sends unix seconds. */
function at(seconds: number): Date {
  return new Date(seconds * 1000);
}

export type EventContext = {
  organizationId: string;
  stripeAccountId: string;
};

/**
 * Which shop an event belongs to.
 *
 * Connect events carry the connected account id on the event itself, and that
 * — not anything inside the payload — is what identifies the tenant. Metadata
 * can be edited in the Stripe Dashboard; `event.account` cannot.
 */
export async function contextFor(
  event: Stripe.Event
): Promise<EventContext | null> {
  if (!event.account) return null;

  const [row] = await db
    .select({ organizationId: connectedAccounts.organizationId })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.stripeAccountId, event.account))
    .limit(1);

  if (!row) return null;
  return { organizationId: row.organizationId, stripeAccountId: event.account };
}

/**
 * The job and invoice a charge is for, **verified against the shop**.
 *
 * Attribution comes from metadata we set when creating the PaymentIntent, and
 * metadata is editable in the Stripe Dashboard — so it is checked against the
 * organization before it is written into a ledger row. Without that check, one
 * edited field would post another shop's money onto a job here.
 *
 * Unverifiable attribution degrades to shop money rather than failing: the
 * payment is real and belongs in the ledger either way, and an entry with no
 * job is a thing the product already knows how to show and reattribute.
 */
async function attribution(
  metadata: Stripe.Metadata | null | undefined,
  organizationId: string
): Promise<{ jobId: string | null; invoiceId: string | null; customerId: string | null }> {
  const jobId = metadata?.jobId;
  const invoiceId = metadata?.invoiceId;

  if (invoiceId) {
    const [row] = await db
      .select({
        invoiceId: documents.id,
        jobId: jobs.id,
        customerId: jobs.customerId,
      })
      .from(documents)
      .innerJoin(jobs, eq(documents.jobId, jobs.id))
      .where(
        and(
          eq(documents.id, invoiceId),
          eq(documents.type, "invoice"),
          eq(documents.organizationId, organizationId)
        )
      )
      .limit(1);

    if (row) {
      return {
        jobId: row.jobId,
        invoiceId: row.invoiceId,
        customerId: row.customerId,
      };
    }
  }

  if (jobId) {
    const [row] = await db
      .select({ jobId: jobs.id, customerId: jobs.customerId })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
      .limit(1);

    if (row) {
      return { jobId: row.jobId, invoiceId: null, customerId: row.customerId };
    }
  }

  return { jobId: null, invoiceId: null, customerId: null };
}

/* ── Money in ─────────────────────────────────────────────────────────── */

/**
 * A successful charge: the payment, Stripe's fee, and our fee.
 *
 * The fee amounts live on the charge's **balance transaction**, which arrives
 * as an id and has to be retrieved on the connected account. That retrieval is
 * why this is not a one-liner, and skipping it would mean a ledger that knows
 * what the homeowner paid but not what the contractor kept.
 */
export async function onChargeSucceeded(
  charge: Stripe.Charge,
  context: EventContext
) {
  const where = await attribution(charge.metadata, context.organizationId);
  const occurredAt = at(charge.created);

  const payment = await recordEntry({
    organizationId: context.organizationId,
    entryType: "payment_received",
    amountCents: charge.amount,
    currency: charge.currency,
    occurredAt,
    source: "stripe",
    method: methodOf(charge),
    externalRef: charge.id,
    ...where,
  });

  // Only a first delivery says anything. A replayed webhook writes no row, so
  // it can't tell the contractor about the same money twice.
  if (payment) {
    notifyLater({
      kind: "payment.received",
      organizationId: context.organizationId,
      ledgerEntryId: payment.id,
    });
  }

  // Fees are shop money: they come out of the contractor's Stripe balance and
  // belong to no job, which is why `jobId` is deliberately not spread in here.
  const fees = await feesFor(charge, context);

  if (fees.processingCents > 0) {
    await recordEntry({
      organizationId: context.organizationId,
      entryType: "processing_fee",
      amountCents: -fees.processingCents,
      currency: charge.currency,
      occurredAt,
      source: "stripe",
      externalRef: `${charge.id}:processing`,
      // Kept against the invoice so a bill can show what it actually netted,
      // without the fee ever counting as collection.
      invoiceId: where.invoiceId,
    });
  }

  if (fees.applicationCents > 0) {
    await recordEntry({
      organizationId: context.organizationId,
      entryType: "application_fee",
      amountCents: -fees.applicationCents,
      currency: charge.currency,
      occurredAt,
      source: "stripe",
      externalRef: `${charge.id}:application`,
      invoiceId: where.invoiceId,
    });
  }
}

/**
 * What Stripe and we took out of this charge.
 *
 * Our cut is on the charge itself. Stripe's is only on the balance
 * transaction, and on a direct charge that object lives on the *connected*
 * account — retrieving it with the platform's own credentials returns a 404
 * that reads like the object does not exist.
 */
async function feesFor(charge: Stripe.Charge, context: EventContext) {
  const applicationCents = charge.application_fee_amount ?? 0;

  const balanceTransactionId =
    typeof charge.balance_transaction === "string"
      ? charge.balance_transaction
      : charge.balance_transaction?.id;

  if (!balanceTransactionId) {
    return { processingCents: 0, applicationCents };
  }

  // `stripeAccount` is a *request option*, not a query parameter — it becomes
  // the `Stripe-Account` header. Passing it in the params slot type-errors, and
  // omitting it entirely looks up the id on the platform account, where it does
  // not exist.
  const transaction = await stripe().balanceTransactions.retrieve(
    balanceTransactionId,
    {},
    { stripeAccount: context.stripeAccountId }
  );

  // `fee` is everything Stripe deducted, our application fee included when it
  // was charged to the account. Subtracting it keeps the two rows from
  // double-counting the same cents.
  const stripeFee = transaction.fee_details
    .filter((detail) => detail.type !== "application_fee")
    .reduce((sum, detail) => sum + detail.amount, 0);

  return { processingCents: stripeFee, applicationCents };
}

/* ── Money back out ───────────────────────────────────────────────────── */

/**
 * Refunds, keyed individually.
 *
 * A charge refunded in three parts fires this three times and carries all three
 * refunds in the payload each time. Keying on the refund's own id rather than
 * the charge's is what makes the second delivery write one new row instead of
 * three duplicates.
 */
export async function onChargeRefunded(
  charge: Stripe.Charge,
  context: EventContext
) {
  const where = await attribution(charge.metadata, context.organizationId);

  for (const refund of charge.refunds?.data ?? []) {
    if (refund.status !== "succeeded") continue;

    await recordEntry({
      organizationId: context.organizationId,
      entryType: "refund_issued",
      amountCents: -refund.amount,
      currency: refund.currency,
      occurredAt: at(refund.created),
      source: "stripe",
      method: methodOf(charge),
      externalRef: refund.id,
      memo: refund.reason ? `Refund — ${refund.reason}` : null,
      ...where,
    });
  }
}

/**
 * The homeowner disputed. The money leaves now, months after the job.
 *
 * This is the event the whole ledger was designed around: $3,000 leaves the
 * contractor's balance and no invoice, contract or change order changed. Under
 * a documents-only model there is nowhere to put it.
 */
export async function onDisputeCreated(
  dispute: Stripe.Dispute,
  context: EventContext
) {
  const charge =
    typeof dispute.charge === "string" ? null : dispute.charge ?? null;

  const where = await attribution(
    charge?.metadata ?? dispute.metadata,
    context.organizationId
  );

  await recordEntry({
    organizationId: context.organizationId,
    entryType: "chargeback_opened",
    amountCents: -dispute.amount,
    currency: dispute.currency,
    occurredAt: at(dispute.created),
    source: "stripe",
    externalRef: dispute.id,
    memo: `Dispute opened — ${dispute.reason.replace(/_/g, " ")}`,
    ...where,
  });
}

/**
 * The dispute closed. Only a win moves money back.
 *
 * A loss writes nothing, because the money already left when the dispute
 * opened — writing a second negative row would debit the contractor twice for
 * one chargeback.
 */
export async function onDisputeClosed(
  dispute: Stripe.Dispute,
  context: EventContext
) {
  if (dispute.status !== "won") return;

  const charge =
    typeof dispute.charge === "string" ? null : dispute.charge ?? null;

  const where = await attribution(
    charge?.metadata ?? dispute.metadata,
    context.organizationId
  );

  await recordEntry({
    organizationId: context.organizationId,
    entryType: "chargeback_reversed",
    amountCents: dispute.amount,
    currency: dispute.currency,
    occurredAt: new Date(),
    source: "stripe",
    externalRef: `${dispute.id}:won`,
    memo: "Dispute resolved in your favour",
    ...where,
  });
}

/* ── Money to the bank ────────────────────────────────────────────────── */

/**
 * Stripe balance → the contractor's bank.
 *
 * **Always shop money, never job money**, and the database enforces it. Three
 * card payments across three jobs on Tuesday arrive as one lump on Thursday,
 * and that lump belongs to no job. It is recorded because it appears on his
 * bank statement and the bank-feed matcher must not read it as a fourth
 * customer payment — never because it settles anything.
 */
export async function onPayoutPaid(
  payout: Stripe.Payout,
  context: EventContext
) {
  await recordEntry({
    organizationId: context.organizationId,
    entryType: "payout",
    amountCents: -payout.amount,
    currency: payout.currency,
    // `arrival_date` — when it lands in his bank, which is the date on the
    // statement the matcher will compare against. `created` is when Stripe
    // decided to send it, which appears nowhere he can see.
    occurredAt: at(payout.arrival_date),
    source: "stripe",
    externalRef: payout.id,
  });
}
