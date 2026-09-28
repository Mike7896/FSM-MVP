import "server-only";

import Stripe from "stripe";

import { serverEnv } from "@/lib/env";

let cached: Stripe | undefined;

/**
 * Server-side Stripe SDK.
 *
 * `apiVersion` is pinned to the version this SDK's TypeScript types were
 * generated against. Leaving it unset would follow the account's Dashboard
 * version, which can drift away from the types and break silently at runtime.
 * Change it only together with a Stripe SDK upgrade.
 */
export function stripe(): Stripe {
  if (cached) return cached;

  const { STRIPE_SECRET_KEY } = serverEnv();
  if (!STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }

  cached = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2026-07-29.dahlia",
    typescript: true,
    appInfo: { name: "ServiceClerk" },
  });

  return cached;
}

/** Stripe sends timestamps as unix seconds. */
export function toDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}
