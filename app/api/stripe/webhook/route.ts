import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { withOperationLock } from "@/lib/db/operation-lock";
import { stripeEvents } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe/server";
import { upsertPrice, upsertProduct } from "@/lib/stripe/sync";
import {
  MEMBERSHIP_EVENTS,
  handleMembershipEvent,
} from "@/lib/membership/webhook";

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

const CATALOG_EVENTS = new Set<Stripe.Event.Type>([
  "product.created",
  "product.updated",
  "product.deleted",
  "price.created",
  "price.updated",
  "price.deleted",
]);

const RELEVANT_EVENTS = new Set<Stripe.Event.Type>([
  ...CATALOG_EVENTS,
  ...MEMBERSHIP_EVENTS,
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

  try {
    const duplicate = await withOperationLock(event.id, 23, async () => {
      const [done] = await db.select({ id: stripeEvents.id }).from(stripeEvents)
        .where(eq(stripeEvents.id, event.id)).limit(1);
      if (done) return true;
      // Side effects have natural idempotency keys. A process failure happens
      // before this receipt so redelivery retries any unfinished effects.
      await handleEvent(event);
      await db.insert(stripeEvents).values({ id: event.id, type: event.type });
      return false;
    });
    return NextResponse.json({ received: true, ...(duplicate ? { duplicate: true } : {}) });
  } catch (error) {
    console.error(`[stripe] Failed handling ${event.type} (${event.id}):`, error);
    return NextResponse.json({ error: "Event processing failed" }, { status: 500 });
  }
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case "product.created":
    case "product.updated":
      await upsertProduct(event.data.object);
      return;

    case "price.created":
    case "price.updated":
      await upsertPrice(event.data.object);
      return;

    case "product.deleted":
      await upsertProduct({ ...event.data.object, active: false });
      return;

    case "price.deleted":
      await upsertPrice({ ...event.data.object, active: false });
      return;
  }

  // Everything else is the membership: subscriptions, schedules, invoices and
  // checkouts, each reconciled from a fresh read of Stripe (Billing §11.2).
  if (MEMBERSHIP_EVENTS.has(event.type)) {
    await handleMembershipEvent(event);
  }
}
