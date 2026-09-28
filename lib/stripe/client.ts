"use client";

import { loadStripe, type Stripe } from "@stripe/stripe-js";

import { clientEnv } from "@/lib/env";

let stripePromise: Promise<Stripe | null> | undefined;

/** Lazily loads Stripe.js once per page. */
export function getStripe() {
  if (!stripePromise) {
    const key = clientEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      throw new Error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set.");
    }
    stripePromise = loadStripe(key);
  }
  return stripePromise;
}
