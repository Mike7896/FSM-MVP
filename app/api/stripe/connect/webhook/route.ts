import type Stripe from "stripe";
import { eq } from "drizzle-orm";
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

  // Same claim table as the subscription webhook — Stripe event ids are unique
  // across both streams, so one table is correct rather than convenient.
  const claimed = await db
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: stripeEvents.id });

  if (claimed.length === 0) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);
  } catch (error) {
    // Release the claim so Stripe's retry gets a real second attempt.
    await db
      .delete(stripeEvents)
      .where(eq(stripeEvents.id, event.id))
      .catch(() => {});

    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[connect] Failed handling ${event.type} (${event.id}):`,
      error
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
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
      break;

    case "charge.dispute.created":
      await onDisputeCreated(event.data.object, context);
      break;

    case "charge.dispute.closed":
      await onDisputeClosed(event.data.object, context);
      break;

    case "payout.paid":
      await onPayoutPaid(event.data.object, context);
      break;
  }
}
