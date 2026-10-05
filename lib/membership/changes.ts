import "server-only";

import type Stripe from "stripe";

import { db } from "@/lib/db";
import { withOperationLock } from "@/lib/db/operation-lock";
import { billingEvents } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { stripe } from "@/lib/stripe/server";

import { readAccess, type Access } from "./access";
import {
  PACK_LABEL,
  POLICY,
  TIER_LABEL,
  coreLookupKey,
  packLookupKey,
  type BillingInterval,
  type PackId,
  type PaidTier,
} from "./catalog";
import { getPriceBook, priceIdFor } from "./prices";
import { configOf, reconcileSubscription, roleOf } from "./reconcile";
import { getReleases } from "./releases";
import { reportError } from "@/lib/observability";

/**
 * CHANGING A MEMBERSHIP (§5.2).
 *
 * The caller names the configuration it wants **from the next renewal on** —
 * tier, interval, packs. That one target splits into two changes:
 *
 * - **Now**, for whatever costs more: a higher tier or an added pack, prorated
 *   to the renewal date and paid before it is granted. Stripe holds the update
 *   as *pending* until its invoice is paid, so a declined card leaves the old
 *   configuration exactly as it was.
 * - **At renewal**, for whatever costs less or changes the interval: a lower
 *   tier, a removed pack, monthly ↔ annual. Kept in a Stripe subscription
 *   schedule so the change is on Stripe's side as well as ours.
 *
 * An immediate change always carries into the scheduled one — adding a pack
 * while a downgrade is scheduled keeps the pack after the downgrade.
 */

export type MembershipConfig = {
  tier: PaidTier;
  interval: BillingInterval;
  packs: PackId[];
};

export type ChangePreview = {
  current: MembershipConfig;
  /** Charged now and granted once paid. Null when nothing costs more. */
  immediate: {
    config: MembershipConfig;
    /** Due now, tax included when Stripe Tax is calculating. */
    dueNowCents: number;
    taxCents: number;
    /** Below Stripe's minimum charge: it goes on the next bill instead (§5.2). */
    addedToNextBill: boolean;
    /** Unix seconds. The apply must use this same moment (§5.2, [S5]). */
    prorationDate: number;
  } | null;
  /** Takes effect at the renewal. Null when the next period matches now. */
  scheduled: { config: MembershipConfig; effectiveAt: string } | null;
  /** The recurring amount from the renewal on, before tax. */
  renewalCents: number | null;
  renewalAt: string | null;
  /** A cancellation that this change will undo. */
  resumesCancelled: boolean;
};

const RANK: Record<PaidTier, number> = { starter: 1, pro: 2 };

function same(a: MembershipConfig, b: MembershipConfig) {
  return (
    a.tier === b.tier &&
    a.interval === b.interval &&
    [...a.packs].sort().join() === [...b.packs].sort().join()
  );
}

async function loadSubscription(access: Access) {
  if (!access.subscriptionId) {
    throw new DomainError("There's no membership to change yet. Choose a plan first.", "conflict");
  }
  if (access.standing !== "paid") {
    throw new DomainError(
      "Your last renewal hasn't been paid. Update your card first — nothing can be added until it settles.",
      "conflict"
    );
  }
  return stripe().subscriptions.retrieve(access.subscriptionId, { expand: ["schedule"] });
}

function currentConfig(subscription: Stripe.Subscription): MembershipConfig {
  const config = configOf(subscription.items.data.map((item) => item.price));
  if (!config.tier || !config.interval) {
    throw new DomainError("This subscription doesn't hold a ServiceClerk plan.", "conflict");
  }
  return { tier: config.tier, interval: config.interval, packs: config.packs as PackId[] };
}

async function lineItems(config: MembershipConfig, founding: boolean) {
  const ids = await Promise.all([
    priceIdFor(coreLookupKey(config.tier, config.interval, founding)),
    ...config.packs.map((pack) => priceIdFor(packLookupKey(pack, config.interval))),
  ]);
  return ids.map((price) => ({ price, quantity: 1 }));
}

/** The subscription-item edits that take `current` to `next` at the same interval. */
async function itemUpdates(
  subscription: Stripe.Subscription,
  next: MembershipConfig,
  founding: boolean
): Promise<Stripe.SubscriptionUpdateParams.Item[]> {
  const updates: Stripe.SubscriptionUpdateParams.Item[] = [];
  const coreItem = subscription.items.data.find((item) => roleOf(item.price)?.kind === "core");
  const current = currentConfig(subscription);

  if (coreItem && current.tier !== next.tier) {
    updates.push({
      id: coreItem.id,
      price: await priceIdFor(coreLookupKey(next.tier, current.interval, founding)),
    });
  }
  for (const pack of next.packs) {
    if (!current.packs.includes(pack)) {
      updates.push({ price: await priceIdFor(packLookupKey(pack, current.interval)), quantity: 1 });
    }
  }
  return updates;
}

async function validateReleases(current: MembershipConfig, target: MembershipConfig) {
  const releases = await getReleases();
  if (target.tier === "pro" && current.tier !== "pro" && !releases.pro) {
    throw new DomainError("Pro isn't available yet.", "conflict");
  }
  for (const pack of target.packs) {
    if (!current.packs.includes(pack) && !releases[`pack_${pack}`]) {
      throw new DomainError(`The ${PACK_LABEL[pack]} pack isn't available yet.`, "conflict");
    }
  }
}

function splitTarget(current: MembershipConfig, target: MembershipConfig) {
  const immediate: MembershipConfig = {
    tier: RANK[target.tier] > RANK[current.tier] ? target.tier : current.tier,
    interval: current.interval,
    packs: [...new Set([...current.packs, ...target.packs])],
  };
  return {
    immediate: same(immediate, current) ? null : immediate,
    scheduled: same(target, immediate) ? null : target,
  };
}

async function recurringCents(config: MembershipConfig, founding: boolean) {
  const book = await getPriceBook();
  const keys = [
    coreLookupKey(config.tier, config.interval, founding),
    ...config.packs.map((pack) => packLookupKey(pack, config.interval)),
  ];
  let total = 0;
  for (const key of keys) {
    const price = book.get(key);
    if (!price) return null;
    total += price.unitAmount;
  }
  return total;
}

export async function previewChange(
  organizationId: string,
  target: MembershipConfig,
  now = new Date()
): Promise<ChangePreview> {
  const access = await readAccess(organizationId, now);
  const subscription = await loadSubscription(access);
  const current = currentConfig(subscription);
  await validateReleases(current, target);

  const founding = access.founding.price;
  const split = splitTarget(current, target);
  const periodEnd = subscription.items.data[0]?.current_period_end ?? null;

  let immediate: ChangePreview["immediate"] = null;
  if (split.immediate) {
    const prorationDate = Math.floor(now.getTime() / 1000);
    const preview = await stripe().invoices.createPreview({
      customer: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      subscription: subscription.id,
      subscription_details: {
        items: await itemUpdates(subscription, split.immediate, founding),
        proration_behavior: "always_invoice",
        proration_date: prorationDate,
      },
    });
    const taxCents = (preview.total_taxes ?? []).reduce((sum, row) => sum + row.amount, 0);
    immediate = {
      config: split.immediate,
      dueNowCents: preview.amount_due,
      taxCents,
      addedToNextBill: preview.amount_due > 0 && preview.amount_due < POLICY.minimumChargeCents,
      prorationDate,
    };
  }

  const renewalConfig = split.scheduled ?? split.immediate ?? current;

  return {
    current,
    immediate,
    scheduled: split.scheduled && periodEnd
      ? { config: split.scheduled, effectiveAt: new Date(periodEnd * 1000).toISOString() }
      : null,
    renewalCents: await recurringCents(renewalConfig, founding),
    renewalAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    resumesCancelled: access.cancelAtPeriodEnd,
  };
}

export type ChangeResult =
  | { status: "applied"; preview: ChangePreview }
  | { status: "payment_required"; invoiceUrl: string | null; message: string };

export async function applyChange(input: Parameters<typeof applyChangeLocked>[0]): Promise<ChangeResult> {
  return withOperationLock(input.organizationId, 26, () => applyChangeLocked(input));
}

async function applyChangeLocked(input: {
  organizationId: string;
  target: MembershipConfig;
  /** From the preview the person confirmed. */
  prorationDate: number;
  actorUserId: string;
  /** The subscription's clock — only a test clock ever sets this. */
  now?: Date;
}): Promise<ChangeResult> {
  const now = input.now ?? new Date();
  const age = now.getTime() / 1000 - input.prorationDate;
  if (age < 0 || age > 30 * 60) {
    throw new DomainError("That price check is out of date. Review the change again.", "conflict");
  }

  const access = await readAccess(input.organizationId, now);
  if (!access.canChangePlan) {
    throw new DomainError(
      access.pending
        ? "A change is already waiting for its payment. Finish or cancel that one first."
        : "Your last renewal hasn't been paid. Update your card first.",
      "conflict"
    );
  }
  const subscription = await loadSubscription(access);
  const current = currentConfig(subscription);
  await validateReleases(current, input.target);

  const founding = access.founding.price;
  const split = splitTarget(current, input.target);
  const schedule =
    subscription.schedule && typeof subscription.schedule !== "string" ? subscription.schedule : null;
  const previousScheduled = access.scheduled;

  // One scheduled configuration per shop: the old one goes, and the new one
  // (if any) is written after the immediate part has been paid for.
  if (schedule && schedule.status !== "released" && schedule.status !== "canceled") {
    await stripe().subscriptionSchedules.release(schedule.id);
  }

  if (split.immediate) {
    const updated = await stripe().subscriptions.update(
      subscription.id,
      {
        items: await itemUpdates(subscription, split.immediate, founding),
        proration_behavior: "always_invoice",
        proration_date: input.prorationDate,
        payment_behavior: "pending_if_incomplete",
        expand: ["latest_invoice"],
      },
      { idempotencyKey: `membership:${input.organizationId}:${input.prorationDate}:${JSON.stringify(split.immediate)}` }
    );

    if (updated.pending_update) {
      // Not paid, so not granted. Put the old renewal plan back as it was.
      if (previousScheduled && previousScheduled.tier && previousScheduled.interval) {
        await writeSchedule(subscription.id, {
          tier: previousScheduled.tier,
          interval: previousScheduled.interval,
          packs: previousScheduled.packs as PackId[],
        }, founding).catch((error) =>
          reportError("[membership] couldn't restore the scheduled change:", error)
        );
      }
      await reconcileSubscription(subscription.id);
      const invoice =
        updated.latest_invoice && typeof updated.latest_invoice !== "string" ? updated.latest_invoice : null;
      await log(input.organizationId, input.actorUserId, "change.payment_required", { target: input.target });
      return {
        status: "payment_required",
        invoiceUrl: invoice?.hosted_invoice_url ?? null,
        message:
          "Your card didn't go through, or your bank wants to confirm it. Nothing has changed yet — finish the payment and the change applies straight away.",
      };
    }
  }

  if (split.scheduled) {
    await writeSchedule(subscription.id, split.scheduled, founding);
  }

  // Choosing a plan is choosing to stay: a pending cancellation is undone.
  if (access.cancelAtPeriodEnd) {
    await stripe().subscriptions.update(subscription.id, { cancel_at_period_end: false });
  }

  await reconcileSubscription(subscription.id);
  await log(input.organizationId, input.actorUserId, "change.applied", {
    target: input.target,
    immediate: split.immediate,
    scheduled: split.scheduled,
  });

  return {
    status: "applied",
    preview: {
      current,
      immediate: null,
      scheduled: null,
      renewalCents: null,
      renewalAt: null,
      resumesCancelled: false,
    },
  };
}

/**
 * The next renewal's configuration, as a Stripe subscription schedule: this
 * period as it is, then one period of `next`, then released to run on.
 */
async function writeSchedule(subscriptionId: string, next: MembershipConfig, founding: boolean) {
  const schedule = await stripe().subscriptionSchedules.create({ from_subscription: subscriptionId });
  const phase = schedule.phases[0];
  if (!phase) throw new DomainError("Stripe didn't return the current phase.", "failed");
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  const currentInterval = configOf(subscription.items.data.map((item) => item.price)).interval;

  await stripe().subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: [
      {
        items: phase.items.map((item) => ({
          price: typeof item.price === "string" ? item.price : item.price.id,
          quantity: item.quantity ?? 1,
        })),
        start_date: phase.start_date,
        end_date: phase.end_date,
        proration_behavior: "none",
      },
      {
        items: await lineItems(next, founding),
        duration: { interval: next.interval, interval_count: 1 },
        proration_behavior: "none",
        // A new interval starts a new cycle, billed the moment it begins.
        // Without this, flexible billing keeps the old anchor and an annual
        // plan starts part-way through a year it never charged for (§5.2).
        ...(next.interval !== currentInterval ? { billing_cycle_anchor: "phase_start" as const } : {}),
      },
    ],
  });
}

/** Paid → Free at the end of the period, packs and all (§4.2, §5.2). */
export async function cancelMembership(organizationId: string, actorUserId: string) {
  return withOperationLock(organizationId, 26, () => cancelMembershipLocked(organizationId, actorUserId));
}

async function cancelMembershipLocked(organizationId: string, actorUserId: string) {
  const access = await readAccess(organizationId);
  if (!access.subscriptionId) throw new DomainError("There's no membership to cancel.", "conflict");

  const subscription = await stripe().subscriptions.retrieve(access.subscriptionId, { expand: ["schedule"] });
  const schedule =
    subscription.schedule && typeof subscription.schedule !== "string" ? subscription.schedule : null;
  if (schedule && schedule.status !== "released" && schedule.status !== "canceled") {
    await stripe().subscriptionSchedules.release(schedule.id);
  }
  await stripe().subscriptions.update(subscription.id, { cancel_at_period_end: true });
  await reconcileSubscription(subscription.id);
  await log(organizationId, actorUserId, "membership.cancel_scheduled", {});
}

/** Undo a scheduled cancellation — the existing renewal resumes, no new charge. */
export async function resumeMembership(organizationId: string, actorUserId: string) {
  return withOperationLock(organizationId, 26, () => resumeMembershipLocked(organizationId, actorUserId));
}

async function resumeMembershipLocked(organizationId: string, actorUserId: string) {
  const access = await readAccess(organizationId);
  if (!access.subscriptionId || !access.cancelAtPeriodEnd) {
    throw new DomainError("Your membership isn't set to end.", "conflict");
  }
  await stripe().subscriptions.update(access.subscriptionId, { cancel_at_period_end: false });
  await reconcileSubscription(access.subscriptionId);
  await log(organizationId, actorUserId, "membership.resumed", {});
}

/** Drop the change scheduled for the renewal; this period's configuration continues. */
export async function keepCurrentPlan(organizationId: string, actorUserId: string) {
  return withOperationLock(organizationId, 26, () => keepCurrentPlanLocked(organizationId, actorUserId));
}

async function keepCurrentPlanLocked(organizationId: string, actorUserId: string) {
  const access = await readAccess(organizationId);
  if (!access.subscriptionId || !access.scheduled || access.scheduled.tier === null) {
    throw new DomainError("Nothing is scheduled to change.", "conflict");
  }
  const subscription = await stripe().subscriptions.retrieve(access.subscriptionId, { expand: ["schedule"] });
  const schedule =
    subscription.schedule && typeof subscription.schedule !== "string" ? subscription.schedule : null;
  if (schedule && schedule.status !== "released" && schedule.status !== "canceled") {
    await stripe().subscriptionSchedules.release(schedule.id);
  }
  await reconcileSubscription(subscription.id);
  await log(organizationId, actorUserId, "change.unscheduled", {});
}

/** The configuration the next renewal will bill — what a pack or plan button edits. */
export function nextConfig(access: Access): MembershipConfig | null {
  if (access.configuredTier === "free" || !access.interval) return null;
  const scheduled = access.scheduled;
  if (scheduled && scheduled.tier && scheduled.interval) {
    return { tier: scheduled.tier, interval: scheduled.interval, packs: scheduled.packs as PackId[] };
  }
  return {
    tier: access.configuredTier as PaidTier,
    interval: access.interval,
    packs: (Object.values(access.packs).filter((pack) => pack.purchased).map((pack) => pack.pack)),
  };
}

export function describeConfig(config: MembershipConfig) {
  return [
    TIER_LABEL[config.tier],
    ...config.packs.map((pack) => `${PACK_LABEL[pack]} pack`),
  ].join(" + ") + (config.interval === "year" ? ", billed yearly" : ", billed monthly");
}

async function log(organizationId: string, actorUserId: string | null, kind: string, detail: Record<string, unknown>) {
  await db.insert(billingEvents).values({ organizationId, actorUserId, kind, detail });
}
