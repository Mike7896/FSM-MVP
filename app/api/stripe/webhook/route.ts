import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { stripeEvents } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe/server";
import {
  deleteSubscription,
  upsertPrice,
  upsertProduct,
  upsertSubscription,
} from "@/lib/stripe/sync";

/**
 * Stripe webhook receiver.
 *
 * Three things this endpoint must get right:
 *
 * 1. **Raw body.** Signature verification hashes the exact bytes Stripe sent.
 *    `request.text()` preserves them; `request.json()` would re-serialize and
 *    every signature check would fail.
 * 2. **No session.** Authentication here is the signature, not a cookie. The
 *    path is excluded from the proxy matcher so it is never redirected.
 * 3. **Idempotency.** Stripe retries on any non-2xx and can deliver duplicates
 *    or out of order. The insert into `stripe_events` is the dedupe gate.
 */

const RELEVANT_EVENTS = new Set<Stripe.Event.Type>([
  "product.created",
  "product.updated",
  "product.deleted",
  "price.created",
  "price.updated",
  "price.deleted",
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(request: NextRequest) {
  const { STRIPE_WEBHOOK_SECRET } = serverEnv();
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("[stripe] STRIPE_WEBHOOK_SECRET is not set.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(
      payload,
      signature,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    // A bad signature is the caller's problem - 400 so Stripe stops retrying.
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[stripe] Signature verification failed: ${message}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!RELEVANT_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  // Claim the event. If the row already exists this is a redelivery and the
  // work has been done, so acknowledge without repeating it.
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
    console.error(`[stripe] Failed handling ${event.type} (${event.id}):`, error);
    // 500 tells Stripe to retry with backoff.
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case "product.created":
    case "product.updated":
      await upsertProduct(event.data.object);
      break;

    case "price.created":
    case "price.updated":
      await upsertPrice(event.data.object);
      break;

    case "product.deleted":
      await upsertProduct({ ...event.data.object, active: false });
      break;

    case "price.deleted":
      await upsertPrice({ ...event.data.object, active: false });
      break;

    case "customer.subscription.created":
    case "customer.subscription.updated":
      await upsertSubscription(event.data.object);
      break;

    case "customer.subscription.deleted":
      await deleteSubscription(event.data.object.id);
      break;

    case "checkout.session.completed": {
      const session = event.data.object;
      // Subscription checkouts also fire customer.subscription.created, but
      // ordering is not guaranteed - sync here too so the UI is correct as
      // soon as the user is redirected back.
      if (session.mode === "subscription" && session.subscription) {
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;
        const subscription =
          await stripe().subscriptions.retrieve(subscriptionId);
        await upsertSubscription(subscription);
      }
      break;
    }
  }
}
