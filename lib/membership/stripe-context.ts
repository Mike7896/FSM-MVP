import "server-only";

import { stripe } from "@/lib/stripe/server";
import { reportError } from "@/lib/observability";

/**
 * Stripe account facts the membership flows depend on, read rarely and kept
 * for a few minutes: whether Stripe Tax can calculate, and which portal
 * configuration is ours.
 */

const TTL_MS = 5 * 60_000;
let taxCache: { at: number; active: boolean } | null = null;
let portalCache: { at: number; id: string | null } | null = null;

/**
 * Tax is calculated only when Stripe Tax is actually set up. **Never read an
 * inactive Tax as "no tax owed"** (§10.1) — the admin readiness panel names
 * the gap; checkout just does not pretend to calculate.
 */
export async function taxCalculationActive(): Promise<boolean> {
  if (taxCache && Date.now() - taxCache.at < TTL_MS) return taxCache.active;
  let active = false;
  try {
    const settings = await stripe().tax.settings.retrieve();
    active = settings.status === "active";
  } catch (error) {
    reportError("[membership] couldn't read Stripe Tax settings:", error);
  }
  taxCache = { at: Date.now(), active };
  return active;
}

/** The customer-portal configuration seeded by `stripe:seed`, if present. */
export async function membershipPortalConfiguration(): Promise<string | null> {
  if (portalCache && Date.now() - portalCache.at < TTL_MS) return portalCache.id;
  let id: string | null = null;
  try {
    const list = await stripe().billingPortal.configurations.list({ active: true, limit: 100 });
    id = list.data.find((row) => row.metadata?.portal === "membership_v1")?.id ?? null;
  } catch (error) {
    reportError("[membership] couldn't list portal configurations:", error);
  }
  portalCache = { at: Date.now(), id };
  return id;
}
