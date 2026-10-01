import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { billingAccounts, billingEvents, stripeEvents } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe/server";

import { PRICES, POLICY } from "./catalog";
import { getPriceBook } from "./prices";
import { getReleases } from "./releases";
import { membershipPortalConfiguration } from "./stripe-context";

/**
 * RELEASE VALIDATION — Billing §14.2.
 *
 * The gates the spec says no draft can manufacture, checked against the real
 * Stripe account and settings rather than assumed. A gate that can't be read
 * from anywhere (a tax classification, content rights) is listed as a human
 * decision, never marked passed.
 */

export type Gate = {
  label: string;
  state: "ok" | "open" | "decide";
  detail: string;
};

export async function billingReadiness(): Promise<Gate[]> {
  const gates: Gate[] = [];
  const env = serverEnv();
  const [book, releases, portal, [lastEvent]] = await Promise.all([
    getPriceBook(),
    getReleases(),
    membershipPortalConfiguration(),
    db.select().from(stripeEvents).orderBy(desc(stripeEvents.processedAt)).limit(1),
  ]);

  const missing = PRICES.filter((price) => {
    const live = book.get(price.lookupKey);
    return !live || live.unitAmount !== price.amountCents;
  });
  gates.push({
    label: "Prices match the spec",
    state: missing.length ? "open" : "ok",
    detail: missing.length
      ? `Missing or different: ${missing.map((price) => price.lookupKey).join(", ")}. Run npm run stripe:seed, then npm run stripe:check.`
      : `All ${PRICES.length} lookup keys are mirrored at the spec's amounts.`,
  });

  gates.push({
    label: "Customer portal",
    state: portal ? "ok" : "open",
    detail: portal
      ? "Card, invoices and whole-membership cancellation only — plan changes go through the app."
      : "No membership portal configuration. Run npm run stripe:seed.",
  });

  // Secrets being set says we *could* verify an event; one having been
  // handled says Stripe is actually sending them here.
  const secrets = Boolean(env.STRIPE_WEBHOOK_SECRET && env.STRIPE_CONNECT_WEBHOOK_SECRET);
  gates.push({
    label: "Webhooks",
    state: secrets && lastEvent ? "ok" : "open",
    detail: !secrets
      ? "A webhook signing secret is missing — access can't follow payment without it."
      : !lastEvent
        ? "Both signing secrets are set, but no Stripe event has been handled on this database yet. Check the endpoint URLs in Stripe, or run npm run stripe:listen locally."
        : `Both signing secrets are set, and Stripe events are arriving — the last, ${lastEvent.type}, was handled ${lastEvent.processedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC. Check the endpoints list the events in .env.example.`,
  });

  try {
    const [settings, registrations] = await Promise.all([
      stripe().tax.settings.retrieve(),
      stripe().tax.registrations.list({ status: "active", limit: 100 }),
    ]);
    gates.push({
      label: "SaaS tax (§10.1)",
      state: settings.status === "active" && registrations.data.length > 0 ? "ok" : "open",
      detail:
        settings.status !== "active"
          ? "Stripe Tax isn't set up (it needs your business address), so checkout doesn't calculate tax. Zero is not evidence that none is owed."
          : registrations.data.length === 0
            ? "Stripe Tax is on but has no registrations — it will calculate $0 everywhere. Add the states you're registered in."
            : `Calculating in ${registrations.data.length} registered jurisdiction${registrations.data.length === 1 ? "" : "s"}.`,
    });
  } catch {
    gates.push({ label: "SaaS tax (§10.1)", state: "open", detail: "Couldn't read Stripe Tax settings." });
  }

  gates.push({
    label: "Pro value (§2.2)",
    state: releases.pro ? "ok" : "decide",
    detail: releases.pro
      ? "Pro is on sale: logo branding, quote-view tracking and analytics are built."
      : "Built: logo branding, quote-view tracking, analytics. Turn Pro on when you're happy with them.",
  });

  gates.push({
    label: "Electrical content (§14.2)",
    state: "decide",
    detail: releases.pack_electrical
      ? "The pack is on sale. Make sure its presets and inputs exist — don't charge for content that isn't there."
      : "Not sold. Turn it on only once the pack's presets and inputs exist and any redistributed content is licensed.",
  });

  gates.push({
    label: "ACH fee tax treatment (§10.1)",
    state: "decide",
    detail: releases.ach_application_fee
      ? "The 0.2% ACH fee is being taken. Its tax classification should be settled."
      : "Off — the explicit fallback is a $0 application fee until the fee's tax treatment is settled.",
  });

  gates.push({
    label: "Founding offer (§6)",
    state: releases.founding_offer && releases.foundingLaunchAt ? "ok" : "decide",
    detail:
      releases.founding_offer && releases.foundingLaunchAt
        ? `Open from ${new Date(releases.foundingLaunchAt).toLocaleDateString("en-US", { dateStyle: "medium" })} for ${POLICY.foundingWindowDays} days or ${POLICY.foundingCap} shops. Check what you've already promised anyone.`
        : "Off. Set the paid-launch date and turn it on — after checking any founding promises already made.",
  });

  gates.push({
    label: "Failed-payment retries (§5.3)",
    state: "decide",
    detail:
      "Set in the Stripe Dashboard (Billing → Revenue recovery), not the API: retry over 30 days, then cancel. The app's own 7-day grace and day-30 write-off run either way.",
  });

  return gates;
}

export async function foundingSeats() {
  const [row] = await db
    .select({
      enrolled: sql<number>`count(*) filter (where ${billingAccounts.foundingStatus} = 'enrolled')::int`,
      held: sql<number>`count(*) filter (where ${billingAccounts.foundingStatus} = 'held' and ${billingAccounts.foundingHoldUntil} > now())::int`,
    })
    .from(billingAccounts);
  return { enrolled: row?.enrolled ?? 0, held: row?.held ?? 0, cap: POLICY.foundingCap };
}

export async function recentBillingEvents(limit = 30) {
  return db.select().from(billingEvents).orderBy(desc(billingEvents.occurredAt)).limit(limit);
}

export async function membershipCounts() {
  const rows = await db
    .select({ tier: billingAccounts.tier, status: billingAccounts.subscriptionStatus, n: sql<number>`count(*)::int` })
    .from(billingAccounts)
    .groupBy(billingAccounts.tier, billingAccounts.subscriptionStatus);
  return rows;
}

export { eq };
