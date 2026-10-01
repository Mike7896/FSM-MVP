import "server-only";

import { cache } from "react";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accountPolicies,
  billingAccounts,
  memberships,
  packEnablement,
  packEvaluations,
  type BillingAccount,
  type PackEvaluation,
  type PendingChange,
  type ScheduledChange,
} from "@/lib/db/schema";

import {
  DAY_MS,
  PACK_IDS,
  POLICY,
  TIER_FEATURES,
  type BillingInterval,
  type PackId,
  type Tier,
  type TierFeatures,
} from "./catalog";

/**
 * ACCESS — what a shop may do right now, derived and never stored (§4.1, §5.3).
 *
 * Entitlement is **computed from reconciled billing state plus recorded
 * evaluations and grants**, every time, and never accepted from a browser. The
 * inputs are facts — what Stripe says the subscription is, when it was last
 * paid through, when an evaluation started — and time does the rest: grace
 * ends, an evaluation expires and a founding restoration window closes without
 * a job having to run, so the rules hold even while no scheduler does.
 */

/**
 * - `paid` — current, through the paid-through time.
 * - `grace` — a renewal failed less than seven days ago; previously purchased
 *   access continues, paid additions are blocked.
 * - `restricted` — still unpaid after grace. Free rules apply; records and
 *   collection on existing jobs are untouched.
 * - `comp` — a complimentary account, set by an admin. Treated as Pro.
 * - `free` — no paid membership.
 */
export type Standing = "free" | "paid" | "grace" | "restricted" | "comp";

export type PackAccess = {
  pack: PackId;
  /** On the subscription, and the subscription is in paid or grace standing. */
  purchased: boolean;
  evaluation: {
    startedAt: Date;
    expiresAt: Date;
    /** Running now. */
    active: boolean;
  } | null;
  /** The one evaluation this shop gets has been used (or is running). */
  evaluationUsed: boolean;
  entitled: boolean;
  source: "subscription" | "evaluation" | null;
  /** The owner's visibility preference. Never changes a bill (§4.1). */
  enabled: boolean;
  /** Entitled and switched on — what pack execution checks. */
  usable: boolean;
  /** When a purchased pack stops, if that is already decided. */
  endsAt: Date | null;
};

export type Access = {
  organizationId: string;
  /** The tier whose features apply right now. */
  tier: Tier;
  /** The tier the subscription is configured for, paid or not. */
  configuredTier: Tier;
  configuredPacks: PackId[];
  standing: Standing;
  interval: BillingInterval | null;
  features: TierFeatures;
  packs: Record<PackId, PackAccess>;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;
  paidThrough: Date | null;
  pastDueSince: Date | null;
  graceEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  scheduled: ScheduledChange | null;
  pending: PendingChange | null;
  /**
   * A priced change (upgrade, pack) may be started. Not while a renewal is
   * unpaid, and not while another payment-requiring change is in flight.
   */
  canChangePlan: boolean;
  founding: {
    status: "none" | "held" | "enrolled" | "reversed" | "lapsed";
    /** The core line on the subscription is a founding price. */
    price: boolean;
    /** Resubscribing before this keeps founding prices (§6). */
    restorableUntil: Date | null;
  };
  refund: { eligible: boolean; until: Date | null };
};

export type AccessInput = {
  organizationId: string;
  account: BillingAccount | null;
  evaluations: PackEvaluation[];
  /** Pack id → the owner's switch. Missing means on. */
  enablement: Map<string, boolean>;
  comp: boolean;
  now: Date;
};

const LIVE_STATUSES = new Set(["active", "trialing"]);
const UNPAID_STATUSES = new Set(["past_due", "unpaid"]);

/** Pure — every rule about standing lives here, so the check script can hold it to the spec. */
export function deriveAccess(input: AccessInput): Access {
  const { account, now } = input;
  const at = now.getTime();

  const hasSubscription = Boolean(
    account?.subscriptionId && account.tier !== "free"
  );
  const status = account?.subscriptionStatus ?? null;

  let standing: Standing = "free";
  let pastDueSince: Date | null = null;
  let graceEndsAt: Date | null = null;

  if (hasSubscription && status) {
    if (LIVE_STATUSES.has(status)) {
      standing = account?.paidThrough && account.paidThrough.getTime() > at ? "paid" : "restricted";
    } else if (UNPAID_STATUSES.has(status)) {
      pastDueSince = account!.pastDueSince ?? account!.currentPeriodStart ?? now;
      graceEndsAt = new Date(pastDueSince.getTime() + POLICY.graceDays * DAY_MS);
      standing = at < graceEndsAt.getTime() ? "grace" : "restricted";
    }
  }

  const configuredTier: Tier = hasSubscription ? account!.tier : "free";
  const subscriptionCounts = standing === "paid" || standing === "grace";

  let tier: Tier = subscriptionCounts ? configuredTier : "free";
  if (input.comp && tier !== "pro") {
    tier = "pro";
    if (standing === "free" || standing === "restricted") standing = "comp";
  }

  const scheduled = hasSubscription ? (account!.scheduledChange ?? null) : null;
  const cancelAtPeriodEnd = hasSubscription && (account?.cancelAtPeriodEnd ?? false);
  const periodEnd = account?.currentPeriodEnd ?? null;

  const packs = Object.fromEntries(
    PACK_IDS.map((pack) => {
      const purchased =
        subscriptionCounts && (account?.packs ?? []).includes(pack);
      const row = input.evaluations.find((evaluation) => evaluation.packId === pack);
      const evaluationActive = Boolean(
        row && !row.endedAt && at < row.expiresAt.getTime()
      );
      const entitled = purchased || evaluationActive;
      const enabled = input.enablement.get(pack) ?? true;

      // A purchased pack ends at the period end when the whole membership is
      // cancelling, or when the next configuration leaves it out.
      const leaving =
        purchased &&
        (cancelAtPeriodEnd ||
          (scheduled !== null &&
            (scheduled.tier === null || !scheduled.packs.includes(pack))));

      const access: PackAccess = {
        pack,
        purchased,
        evaluation: row
          ? { startedAt: row.startedAt, expiresAt: row.expiresAt, active: evaluationActive }
          : null,
        evaluationUsed: Boolean(row),
        entitled,
        source: purchased ? "subscription" : evaluationActive ? "evaluation" : null,
        enabled,
        usable: entitled && enabled,
        endsAt: leaving
          ? scheduled?.effectiveAt
            ? new Date(scheduled.effectiveAt)
            : periodEnd
          : evaluationActive && !purchased
            ? row!.expiresAt
            : null,
      };
      return [pack, access];
    })
  ) as Record<PackId, PackAccess>;

  // Founding (§6). A voluntary end keeps the status for thirty days.
  let foundingStatus = account?.foundingStatus ?? "none";
  let restorableUntil: Date | null = null;
  if (foundingStatus === "held" && account?.foundingHoldUntil && account.foundingHoldUntil.getTime() <= at) {
    foundingStatus = "none";
  }
  if (foundingStatus === "enrolled" && !subscriptionCounts && account?.paidAccessEndedAt) {
    const until = new Date(
      account.paidAccessEndedAt.getTime() + POLICY.foundingRestorationDays * DAY_MS
    );
    if (at < until.getTime()) restorableUntil = until;
    else foundingStatus = "lapsed";
  }

  const refundUntil = account?.firstPaidAt
    ? new Date(account.firstPaidAt.getTime() + POLICY.refundWindowDays * DAY_MS)
    : null;

  return {
    organizationId: input.organizationId,
    tier,
    configuredTier,
    configuredPacks: hasSubscription ? (account!.packs as PackId[]) : [],
    standing,
    interval: hasSubscription ? (account!.interval ?? null) : null,
    features: TIER_FEATURES[tier],
    packs,
    subscriptionId: hasSubscription ? account!.subscriptionId : null,
    subscriptionStatus: status,
    currentPeriodEnd: hasSubscription ? periodEnd : null,
    paidThrough: account?.paidThrough ?? null,
    pastDueSince,
    graceEndsAt,
    cancelAtPeriodEnd,
    scheduled,
    pending: hasSubscription ? (account!.pendingChange ?? null) : null,
    canChangePlan: standing === "paid" && !account?.pendingChange,
    founding: {
      status: foundingStatus,
      price: hasSubscription && (account?.foundingPrice ?? false),
      restorableUntil,
    },
    refund: {
      eligible: Boolean(
        standing === "paid" &&
          refundUntil &&
          at < refundUntil.getTime() &&
          !account?.refundedAt
      ),
      until: refundUntil,
    },
  };
}

/** Anything that can read: the pool, or a check script's transaction. */
type Reader = Pick<typeof db, "select">;

/** Everything `deriveAccess` needs, in four small reads. */
export async function loadAccessInput(
  organizationId: string,
  now = new Date(),
  on: Reader = db
): Promise<AccessInput> {
  const [[account], evaluations, enablement, [comp]] = await Promise.all([
    on
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.organizationId, organizationId))
      .limit(1),
    on
      .select()
      .from(packEvaluations)
      .where(eq(packEvaluations.organizationId, organizationId)),
    on
      .select({ packId: packEnablement.packId, enabled: packEnablement.enabled })
      .from(packEnablement)
      .where(eq(packEnablement.organizationId, organizationId)),
    // A complimentary plan is set on the owner, from the admin panel — for
    // good, or free until a date (the last day it counts).
    on
      .select({ compPlan: accountPolicies.compPlan })
      .from(memberships)
      .innerJoin(accountPolicies, eq(accountPolicies.userId, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.role, "owner"),
          eq(accountPolicies.compPlan, true),
          or(isNull(accountPolicies.accessUntil), gte(accountPolicies.accessUntil, sql`current_date`))
        )
      )
      .limit(1),
  ]);

  return {
    organizationId,
    account: account ?? null,
    evaluations,
    enablement: new Map(enablement.map((row) => [row.packId, row.enabled])),
    comp: Boolean(comp?.compPlan),
    now,
  };
}

/** What this shop may do right now. Once per request. */
export const getAccess = cache(
  async (organizationId: string): Promise<Access> =>
    deriveAccess(await loadAccessInput(organizationId))
);

/** Uncached, for writes that must not act on a stale read. */
export async function readAccess(organizationId: string, now = new Date(), on: Reader = db) {
  return deriveAccess(await loadAccessInput(organizationId, now, on));
}
