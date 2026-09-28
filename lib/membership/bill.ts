import "server-only";

import { cache } from "react";

import { getAccess, type Access } from "./access";
import {
  PACK_IDS,
  PACK_LABEL,
  TIER_LABEL,
  coreLookupKey,
  packLookupKey,
  type BillingInterval,
  type PackId,
  type PaidTier,
} from "./catalog";
import { foundingOfferFor, type FoundingOffer } from "./founding";
import { getPriceBook } from "./prices";
import { getReleases, type Releases } from "./releases";

/**
 * What a shop pays, as lines a person can check (Billing §2.1, §12).
 *
 * **One membership, priced additively**: the core plan plus each pack, on one
 * subscription and one renewal date, with the total shown first and the
 * arithmetic under it. Amounts come from the Stripe mirror by lookup key; a
 * line whose price is not on sale here says so rather than showing a number.
 */

export type BillLine = {
  kind: "core" | "pack";
  label: string;
  cents: number | null;
  pack?: PackId;
};

export type Bill = {
  lines: BillLine[];
  /** Pre-tax, per interval. Null when any line has no price here. */
  totalCents: number | null;
  interval: BillingInterval;
};

export async function billFor(
  config: { tier: PaidTier; interval: BillingInterval; packs: readonly PackId[] },
  founding: boolean
): Promise<Bill> {
  const book = await getPriceBook();
  const lines: BillLine[] = [
    {
      kind: "core",
      label: `${TIER_LABEL[config.tier]}${founding ? " (founding price)" : ""}`,
      cents: book.get(coreLookupKey(config.tier, config.interval, founding))?.unitAmount ?? null,
    },
    ...config.packs.map((pack) => ({
      kind: "pack" as const,
      pack,
      label: `${PACK_LABEL[pack]} pack`,
      cents: book.get(packLookupKey(pack, config.interval))?.unitAmount ?? null,
    })),
  ];
  const totalCents = lines.every((line) => line.cents !== null)
    ? lines.reduce((sum, line) => sum + (line.cents ?? 0), 0)
    : null;
  return { lines, totalCents, interval: config.interval };
}

/** The shop's current bill, or null on Free. */
export async function currentBill(access: Access): Promise<Bill | null> {
  if (access.configuredTier === "free" || !access.interval || access.standing === "free") return null;
  const packs = PACK_IDS.filter((pack) => access.configuredPacks.includes(pack));
  return billFor(
    { tier: access.configuredTier as PaidTier, interval: access.interval, packs },
    access.founding.price
  );
}

/** "$37/mo" or "$370/yr" — the account menu's answer to "what am I paying?" */
export const getBillSummary = cache(async (organizationId: string): Promise<string | null> => {
  const access = await getAccess(organizationId);
  const bill = await currentBill(access);
  if (!bill || bill.totalCents === null) return null;
  const dollars = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: bill.totalCents % 100 === 0 ? 0 : 2,
  }).format(bill.totalCents / 100);
  return `${dollars}/${bill.interval === "year" ? "yr" : "mo"}`;
});

export type PublicPricing = {
  releases: Releases;
  /** Cents by tier and interval; null where the price isn't on sale here. */
  core: Record<PaidTier, Record<BillingInterval, number | null>>;
  founder: Record<PaidTier, Record<BillingInterval, number | null>>;
  packs: Record<PackId, Record<BillingInterval, number | null>>;
  founding: FoundingOffer;
};

/** Everything a pricing surface quotes, from Stripe's prices and the release switches. */
export const getPublicPricing = cache(async (organizationId: string | null = null): Promise<PublicPricing> => {
  const [book, releases, founding] = await Promise.all([
    getPriceBook(),
    getReleases(),
    foundingOfferFor(organizationId),
  ]);
  const at = (key: string) => book.get(key)?.unitAmount ?? null;
  const tiers = (founder: boolean) => ({
    starter: { month: at(coreLookupKey("starter", "month", founder)), year: at(coreLookupKey("starter", "year", founder)) },
    pro: { month: at(coreLookupKey("pro", "month", founder)), year: at(coreLookupKey("pro", "year", founder)) },
  });
  return {
    releases,
    core: tiers(false),
    founder: tiers(true),
    packs: { electrical: { month: at(packLookupKey("electrical", "month")), year: at(packLookupKey("electrical", "year")) } },
    founding,
  };
});

/** Twelve monthly payments minus the annual price — the saving an annual plan states (§12). */
export function annualSaving(monthCents: number | null, yearCents: number | null) {
  if (monthCents === null || yearCents === null) return null;
  return monthCents * 12 - yearCents;
}

/** $370 → "$30.83" a month, for explanation only (§2.1). */
export function monthlyEquivalent(yearCents: number | null) {
  return yearCents === null ? null : Math.round(yearCents / 12);
}

/** The picker's props, for a viewer (a shop, or nobody on the public page). */
export async function pickerPricing(organizationId: string | null = null) {
  const pricing = await getPublicPricing(organizationId);
  return {
    core: pricing.core,
    founder: pricing.founder,
    packs: pricing.packs,
    founding: pricing.founding.eligible,
    foundingRemaining: pricing.founding.eligible ? pricing.founding.remaining : null,
    proAvailable: pricing.releases.pro,
    electricalAvailable: pricing.releases.pack_electrical,
  };
}
