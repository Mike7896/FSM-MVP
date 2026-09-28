import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { stripeEvents } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe/server";
import { syncConnectedAccount } from "@/lib/stripe/connect";
import {
  contextFor,
  onChargeRefunded,
  onChargeSucceeded,
  onDisputeClosed,
  onDisputeCreated,
  onPayoutPaid,
} from "@/lib/stripe/connect-events";
import {
  onAttemptRefunded,
  onAttemptReversed,
  onPaymentIntentEvent,
} from "@/lib/stripe/collect";

/**
 * The Connect webhook — contractors charging homeowners.
 *
 * **A different endpoint from `/api/stripe/webhook`, and it has to be.** That
 * one receives account events for our own Stripe account, where the subscription
 * lives. This one receives *Connect* events, which Stripe signs with a separate
 * secret and delivers with `event.account` set to the connected account they
 * happened on. Pointing both at one URL means one signing secret has to verify
 * two streams, and Stripe does not sign them the same way.
 *
 * The three properties from the subscription webhook hold here too — raw body
 * for signature verification, no session, and an idempotency claim before any
 * work — and one more matters more here than there: **every handler writes
 * through `recordEntry`**, which is itself idempotent. So a redelivery that
 * somehow gets past the event claim still cannot double-post money.
 */

const RELEVANT_EVENTS = new Set<Stripe.Event.Type>([
  // Capability state — whether a pay button may appear at all.
  "account.updated",

  // Money.
  "charge.succeeded",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "payout.paid",

  // Where each online attempt has got to — processing is not paid (Billing §8.3).
  "payment_intent.processing",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
]);

export async function POST(request: NextRequest) {
  const { STRIPE_CONNECT_WEBHOOK_SECRET } = serverEnv();
  if (!STRIPE_CONNECT_WEBHOOK_SECRET) {
    console.error("[connect] STRIPE_CONNECT_WEBHOOK_SECRET is not set.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // The exact bytes Stripe sent. `request.json()` would re-serialize and every
  // signature check would fail.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(
      payload,
      signature,
      STRIPE_CONNECT_WEBHOOK_SECRET
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[connect] Signature verification failed: ${message}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!RELEVANT_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  try {
    const duplicate = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${event.id}::text, 23))`);
      const [done] = await tx.select({ id: stripeEvents.id }).from(stripeEvents)
        .where(eq(stripeEvents.id, event.id)).limit(1);
      if (done) return true;
      // Side effects have natural idempotency keys. A process failure rolls
      // back this receipt so redelivery retries any unfinished effects.
      await handleEvent(event);
      await tx.insert(stripeEvents).values({ id: event.id, type: event.type });
      return false;
    });
    return NextResponse.json({ received: true, ...(duplicate ? { duplicate: true } : {}) });
  } catch (error) {
    console.error(`[stripe] Failed handling ${event.type} (${event.id}):`, error);
    return NextResponse.json({ error: "Event processing failed" }, { status: 500 });
  }
}

async function handleEvent(event: Stripe.Event) {
  if (event.type === "account.updated") {
    await syncConnectedAccount(event.data.object);
    return;
  }

  const context = await contextFor(event);
  if (!context) {
    // An event from an account we have no row for. Acknowledged rather than
    // retried: Stripe would redeliver this for days, and no amount of retrying
    // will make an unknown account known.
    console.warn(
      `[connect] ${event.type} (${event.id}) from unknown account ` +
        `${event.account ?? "<none>"}; acknowledged without recording.`
    );
    return;
  }

  switch (event.type) {
    case "charge.succeeded":
      await onChargeSucceeded(event.data.object, context);
      break;

    case "charge.refunded":
      await onChargeRefunded(event.data.object, context);
      // ServiceClerk's share of an ACH fee goes back with the money.
      await onAttemptRefunded(event.data.object, context);
      break;

    case "charge.dispute.created":
      await onDisputeCreated(event.data.object, context);
      break;

    case "charge.dispute.closed": {
      await onDisputeClosed(event.data.object, context);
      // A dispute or ACH return lost: ServiceClerk's fee on it comes back too.
      const dispute = event.data.object;
      if (dispute.status === "lost") {
        const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
        const charge = await stripe().charges.retrieve(chargeId, {}, { stripeAccount: context.stripeAccountId });
        await onAttemptReversed(charge, context);
      }
      break;
    }

    case "payment_intent.processing":
    case "payment_intent.succeeded":
    case "payment_intent.canceled":
      await onPaymentIntentEvent(event.data.object, context);
      break;

    case "payment_intent.payment_failed":
      await onPaymentIntentEvent(event.data.object, context);
      break;

    case "payout.paid":
      await onPayoutPaid(event.data.object, context);
      break;
  }
}
