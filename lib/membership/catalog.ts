/**
 * THE MEMBERSHIP CATALOG — Launch Billing Specification §2, §3, §5–§8, §11.1.
 *
 * What a shop can buy from ServiceClerk, what each thing costs, and what it
 * unlocks, written once. Everything else in `lib/membership` reads this file;
 * the Stripe fixtures are generated from it (`npm run stripe:fixtures`) and
 * `npm run stripe:check` compares the sandbox against it, so the spec, the
 * code and the Stripe account cannot quietly disagree.
 *
 * **Amounts here are the spec, not the display.** Pages show what the Stripe
 * read-model says a price costs, looked up by `lookupKey` — the money has to
 * come from the system that will actually charge it. These amounts exist so
 * the fixtures can create those prices and the check can prove they match.
 *
 * No React, no database, no `server-only`: pages, API routes, scripts and the
 * fixtures generator all import it.
 */

export type Tier = "free" | "starter" | "pro";
export type PaidTier = Exclude<Tier, "free">;
export type BillingInterval = "month" | "year";
/** Packs a shop can buy. Only Electrical is sold at launch. */
export type PackId = "electrical";

export const PAID_TIERS: readonly PaidTier[] = ["starter", "pro"];
export const PACK_IDS: readonly PackId[] = ["electrical"];

/* ── Stripe products and prices (§11.1) ───────────────────────────────── */

/**
 * Product ids are fixed rather than generated so every sandbox, and live, has
 * the same four products under the same names. Stripe accepts a custom id at
 * creation.
 */
export const PRODUCTS = {
  core_starter: {
    id: "sc_core_starter",
    name: "ServiceClerk Starter",
    description:
      "Unlimited jobs, quotes, contracts, deposits, progress invoices and payment collection for one shop.",
  },
  core_pro: {
    id: "sc_core_pro",
    name: "ServiceClerk Pro",
    description:
      "Everything in Starter, plus your logo on documents, quote-view tracking and business analytics.",
  },
  pack_electrical: {
    id: "sc_pack_electrical",
    name: "Electrical pack",
    description:
      "Electrical presets and specialist inputs. Requires a Starter or Pro membership.",
  },
  ai_credits: {
    id: "sc_ai_credits",
    name: "AI credits",
    description: "1,000 prepaid AI credits. Not sold until AI is released.",
  },
} as const;

export type ProductKey = keyof typeof PRODUCTS;

/**
 * Stripe Tax code for SaaS sold to a business. Tax classification is a
 * release gate (§10.1, §14.2): the code is set so calculation works once
 * registrations exist, not as a finding that tax is or isn't owed.
 */
export const SAAS_TAX_CODE = "txcd_10103001";

export type CatalogPrice = {
  lookupKey: string;
  product: ProductKey;
  /** What the price is for, as the app reasons about it. */
  role:
    | { kind: "core"; tier: PaidTier; founding: boolean }
    | { kind: "pack"; pack: PackId }
    | { kind: "ai_topup"; credits: number };
  amountCents: number;
  /** Null for a one-time price. */
  interval: BillingInterval | null;
  /** The release a price waits on, if any (§11.1 "Availability"). */
  release: ReleaseKey | null;
};

export const PRICES: readonly CatalogPrice[] = [
  core("core_starter_month_v1", "starter", false, 2900, "month", null),
  core("core_starter_year_v1", "starter", false, 29000, "year", null),
  core("core_pro_month_v1", "pro", false, 4900, "month", "pro"),
  core("core_pro_year_v1", "pro", false, 49000, "year", "pro"),
  {
    lookupKey: "pack_electrical_month_v1",
    product: "pack_electrical",
    role: { kind: "pack", pack: "electrical" },
    amountCents: 800,
    interval: "month",
    release: "pack_electrical",
  },
  {
    lookupKey: "pack_electrical_year_v1",
    product: "pack_electrical",
    role: { kind: "pack", pack: "electrical" },
    amountCents: 8000,
    interval: "year",
    release: "pack_electrical",
  },
  core("founder_starter_month_v1", "starter", true, 1900, "month", "founding_offer"),
  core("founder_starter_year_v1", "starter", true, 19000, "year", "founding_offer"),
  core("founder_pro_month_v1", "pro", true, 3900, "month", "pro"),
  core("founder_pro_year_v1", "pro", true, 39000, "year", "pro"),
  {
    lookupKey: "ai_1000_credits_v1",
    product: "ai_credits",
    role: { kind: "ai_topup", credits: 1000 },
    amountCents: 1000,
    interval: null,
    release: "ai_credits",
  },
];

function core(
  lookupKey: string,
  tier: PaidTier,
  founding: boolean,
  amountCents: number,
  interval: BillingInterval,
  release: ReleaseKey | null
): CatalogPrice {
  return {
    lookupKey,
    product: tier === "starter" ? "core_starter" : "core_pro",
    role: { kind: "core", tier, founding },
    amountCents,
    interval,
    release,
  };
}

export function catalogPrice(lookupKey: string | null | undefined) {
  return PRICES.find((price) => price.lookupKey === lookupKey) ?? null;
}

/** The lookup key for a core plan, public or founding. */
export function coreLookupKey(
  tier: PaidTier,
  interval: BillingInterval,
  founding: boolean
): string {
  const found = PRICES.find(
    (price) =>
      price.role.kind === "core" &&
      price.role.tier === tier &&
      price.role.founding === founding &&
      price.interval === interval
  );
  if (!found) throw new Error(`No core price for ${tier}/${interval}.`);
  return found.lookupKey;
}

export function packLookupKey(pack: PackId, interval: BillingInterval): string {
  const found = PRICES.find(
    (price) =>
      price.role.kind === "pack" &&
      price.role.pack === pack &&
      price.interval === interval
  );
  if (!found) throw new Error(`No ${pack} price for ${interval}.`);
  return found.lookupKey;
}

/* ── Releases (§2.2 Pro readiness, §7.1, §14.2) ───────────────────────── */

/**
 * Things that are built but not sold until someone decides they are ready.
 *
 * Stored in `billing_releases` and switched from the admin panel. A missing
 * row is **off**: a new environment sells nothing it was not told to.
 */
export const RELEASES = {
  pro: {
    label: "Pro plan",
    detail:
      "Sell Pro. Only when logo branding, quote-view tracking and business analytics are working (§2.2).",
  },
  pack_electrical: {
    label: "Electrical pack",
    detail:
      "Sell the Electrical pack and allow its 14-day evaluation. Only once its content exists (§14.2).",
  },
  founding_offer: {
    label: "Founding-member offer",
    detail:
      "Offer founding prices to the first 50 paying shops within 90 days of the launch date set here (§6).",
  },
  ach_application_fee: {
    label: "ACH application fee",
    detail:
      "Take 0.2% (capped at $5) on successful homeowner ACH payments. Off until its tax treatment is settled (§10.1).",
  },
  ai_credits: {
    label: "AI credits",
    detail:
      "Grant and sell AI credits. Only after the cost and quality gate passes (§7.3).",
  },
} as const;

export type ReleaseKey = keyof typeof RELEASES;
export const RELEASE_KEYS = Object.keys(RELEASES) as ReleaseKey[];

/* ── What each tier includes (§2.2) ───────────────────────────────────── */

export type TierFeatures = {
  /** Newly activated jobs per UTC calendar month. Null is unlimited. */
  monthlyActivations: number | null;
  /** "Made with ServiceClerk" on newly issued documents. */
  promoFooter: boolean;
  /** Custom logo and brand look on newly issued documents. */
  branding: boolean;
  /** Quote-view events and their notifications. */
  viewTracking: boolean;
  /** Quote acceptance, collected revenue and aging balances. */
  analytics: boolean;
  /** Saving reusable line items and shop presets. */
  savedItems: boolean;
  /** Stored attachment bytes. */
  storageBytes: number;
  prioritySupport: boolean;
};

const GB = 1024 ** 3;

export const TIER_FEATURES: Record<Tier, TierFeatures> = {
  free: {
    monthlyActivations: 3,
    promoFooter: true,
    branding: false,
    viewTracking: false,
    analytics: false,
    savedItems: false,
    storageBytes: 1 * GB,
    prioritySupport: false,
  },
  starter: {
    monthlyActivations: null,
    promoFooter: false,
    branding: false,
    viewTracking: false,
    analytics: false,
    savedItems: true,
    storageBytes: 10 * GB,
    prioritySupport: false,
  },
  pro: {
    monthlyActivations: null,
    promoFooter: false,
    branding: true,
    viewTracking: true,
    analytics: true,
    savedItems: true,
    storageBytes: 25 * GB,
    prioritySupport: true,
  },
};

export const TIER_LABEL: Record<Tier, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
};

export const PACK_LABEL: Record<PackId, string> = {
  electrical: "Electrical",
};

/* ── Policy numbers (§3, §5, §6, §7) ──────────────────────────────────── */

export const POLICY = {
  /** §2.2 — per uploaded file. */
  maxUploadBytes: 20 * 1024 * 1024,
  /** §3.2 */
  evaluationDays: 14,
  evaluationReminderDays: [10, 13] as const,
  /** §5.3 */
  graceDays: 7,
  dunningNoticeDays: [0, 3, 6] as const,
  writeOffDays: 30,
  /** §5.4 */
  refundWindowDays: 14,
  /** §6 */
  foundingCap: 50,
  foundingWindowDays: 90,
  foundingRestorationDays: 30,
  /** How long a founding seat is held for an unfinished checkout. */
  foundingHoldMinutes: 60,
  /** §5.2 — Stripe's USD minimum charge. Smaller prorations go on the next bill. */
  minimumChargeCents: 50,
  /**
   * An activation reserved but never committed or released — a crashed
   * request — stops holding a slot after this long.
   */
  activationHoldMinutes: 10,
} as const;

export const DAY_MS = 86_400_000;

/* ── AI tariff (§7) — defined now, sold only after the AI release ─────── */

export const AI_TARIFF = {
  proIncludedPerWindow: 500,
  starterIncludedPerWindow: 0,
  topupCredits: 1000,
  topupLookupKey: "ai_1000_credits_v1",
  actions: {
    quote_draft: 20,
    line_item_suggestions: 2,
    follow_up_draft: 5,
    job_note_summary: 5,
  },
} as const;

export type AiAction = keyof typeof AI_TARIFF.actions;

/* ── Homeowner payment fees (§8.2) ────────────────────────────────────── */

/**
 * ServiceClerk's application fee on one successful homeowner payment.
 *
 * Cards: nothing. ACH: 0.2% of the captured amount, rounded half up, capped at
 * $5 — `min(500, floor((A × 2 + 500) / 1000))` in cents, exactly as §8.2
 * writes it. Manual payments never reach here.
 */
export function applicationFeeFor(
  rail: "card" | "ach",
  amountCents: number
): number {
  if (rail !== "ach" || amountCents <= 0) return 0;
  return Math.min(500, Math.floor((amountCents * 2 + 500) / 1000));
}

/* ── The comparison table (§2.2) ──────────────────────────────────────── */

/**
 * `true` included, `false` not, or a short word where yes/no would hide the
 * real answer ("3 a month", "10 GB").
 */
export type ComparisonCell = boolean | string;

export type ComparisonRow = {
  label: string;
  /** One line under the label, where the row needs its terms said. */
  detail?: string;
  values: Record<Tier, ComparisonCell>;
};

export type ComparisonGroup = { title: string; rows: ComparisonRow[] };

/**
 * The entitlement matrix as the pricing page shows it — §2.2, with Pro's
 * branding, view tracking and analytics as decided on 2026-09-28.
 *
 * Built from `TIER_FEATURES`, the same numbers the app enforces, so the table
 * can't promise a limit the product doesn't hold. Anything not yet sold
 * (the Electrical pack before its release) is passed in rather than assumed.
 */
export function comparisonGroups(options: {
  /** "+$8/mo" while the Electrical pack is on sale; null hides the row. */
  electricalAddOn: string | null;
}): ComparisonGroup[] {
  const each = <T,>(pick: (features: TierFeatures, tier: Tier) => T) =>
    ({
      free: pick(TIER_FEATURES.free, "free"),
      starter: pick(TIER_FEATURES.starter, "starter"),
      pro: pick(TIER_FEATURES.pro, "pro"),
    }) as Record<Tier, T>;
  const all = (value: ComparisonCell) => ({ free: value, starter: value, pro: value });
  const gb = (bytes: number) => `${Math.round(bytes / 1024 ** 3)} GB`;

  return [
    {
      title: "Jobs and documents",
      rows: [
        {
          label: "New jobs each month",
          detail: "A job counts once, the first time something goes out on it. Drafts never count.",
          values: each((f) => (f.monthlyActivations === null ? "Unlimited" : `${f.monthlyActivations} a month`)),
        },
        {
          label: "Quotes, contracts, change orders and invoices",
          values: { free: "On those jobs", starter: true, pro: true },
        },
        {
          label: "Deposits, progress bills and the final invoice",
          detail: "Everything after the first send on a job is free, on every plan.",
          values: all(true),
        },
        { label: "Customer links, e-signatures and PDFs", values: all(true) },
        { label: "Customers, jobs and drafts", values: all(true) },
        { label: "Export everything", values: all(true) },
      ],
    },
    {
      title: "Getting paid",
      rows: [
        {
          label: "Card and bank payments from your customers",
          detail: "Through your own Stripe account. Processing fees apply, the same on every plan.",
          values: all(true),
        },
        { label: "Record cash, checks and transfers", values: all(true) },
        { label: "Sent, accepted, signed and paid status", values: all(true) },
        { label: "What's outstanding and what's collected", values: all(true) },
      ],
    },
    {
      title: "Your brand",
      rows: [
        { label: "Business name, contact details and license on documents", values: all(true) },
        {
          label: "No “Made with ServiceClerk” footer",
          detail: "Documents keep the look they were sent with, whatever your plan later.",
          values: each((f) => !f.promoFooter),
        },
        { label: "Your logo on quotes, contracts and invoices", values: each((f) => f.branding) },
      ],
    },
    {
      title: "Working faster",
      rows: [
        { label: "Saved line items, groups and assemblies", values: each((f) => f.savedItems) },
        ...(options.electricalAddOn
          ? [{
              label: "Electrical presets and specialist inputs",
              detail: "The Electrical pack. Needs Starter or Pro; try it free for 14 days on any plan.",
              values: {
                free: "14-day trial",
                starter: options.electricalAddOn,
                pro: options.electricalAddOn,
              },
            }]
          : []),
      ],
    },
    {
      title: "Knowing where you stand",
      rows: [
        { label: "See when a customer opens a quote", values: each((f) => f.viewTracking) },
        {
          label: "Business analytics",
          detail: "Quote acceptance, collected revenue, and what's owed by how late.",
          values: each((f) => f.analytics),
        },
      ],
    },
    {
      title: "Room and help",
      rows: [
        {
          label: "Photos and attachments",
          detail: "Up to 20 MB a file. Documents you send never count.",
          values: each((f) => gb(f.storageBytes)),
        },
        { label: "Owner sign-ins", values: all("1") },
        { label: "Support", values: each((f) => (f.prioritySupport ? "Priority email" : "Email")) },
      ],
    },
  ];
}
