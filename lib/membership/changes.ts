import "server-only";

import type Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";

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
import { runPlanTransition, sameConfig, type PlanTransition } from "./transition";

/**
 * CHANGING A MEMBERSHIP (§5.2).
 *
 * The caller names the configuration it wants **from the next renewal on** —
 * tier, interval, packs. That one target splits into two changes:
 *
 * - **Now**, for whatever costs more: a higher tier or an added pack, prorated
 *   to the renewal date and paid before it is granted. Stripe holds ordinary
 *   updates pending payment. An existing renewal choice instead uses an atomic
 *   decline so its schedule can be restored immediately when payment fails.
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
  const existing = await latestTransition(input.organizationId);
  if (existing && (existing.phase !== "complete" && existing.phase !== "aborted" ||
    existing.prorationDate === input.prorationDate && sameConfig(existing.target, input.target))) {
    if (!sameConfig(existing.target, input.target) || existing.prorationDate !== input.prorationDate) {
      throw new DomainError("Your previous plan change is still finishing. Please retry it or wait for its payment.", "conflict");
    }
    return transitionResult(await executeTransition(input.organizationId, existing, now));
  }
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
  const previousScheduled = access.scheduled;
  const transition: PlanTransition = {
    id: randomUUID(), subscriptionId: subscription.id, target: input.target,
    immediate: split.immediate, scheduled: split.scheduled,
    previous: previousScheduled?.tier && previousScheduled.interval
      ? { tier: previousScheduled.tier, interval: previousScheduled.interval, packs: previousScheduled.packs as PackId[] } : null,
    previousCancel: access.cancelAtPeriodEnd, founding, prorationDate: input.prorationDate,
    periodEnd: subscription.items.data[0].current_period_end,
    update: split.immediate ? {
      items: await itemUpdates(subscription, split.immediate, founding),
      proration_behavior: "always_invoice", proration_date: input.prorationDate,
      // Stripe cannot restore a schedule while an update is pending. Protect
      // an existing renewal choice with an atomic decline, then restore it.
      payment_behavior: previousScheduled || access.cancelAtPeriodEnd ? "error_if_incomplete" : "pending_if_incomplete",
      expand: ["latest_invoice"],
    } : {},
    phase: "prepared", invoiceUrl: null,
  };
  await saveTransition(input.organizationId, transition, input.actorUserId);
  return transitionResult(await executeTransition(input.organizationId, transition, now));
}

function transitionResult(state: PlanTransition): ChangeResult {
  if (state.phase === "aborted") throw new DomainError("That change wasn't completed. Your previous renewal choice has been preserved. Review your plan and try again.", "conflict");
  if (state.phase === "waiting") return {
    status: "payment_required", invoiceUrl: state.invoiceUrl,
    message: "Finish the payment to apply your change. Your requested renewal plan is saved too.",
  };
  return {
    status: "applied",
    preview: {
      current: state.target,
      immediate: null,
      scheduled: null,
      renewalCents: null,
      renewalAt: null,
      resumesCancelled: false,
    },
  };
}

async function latestTransition(organizationId: string): Promise<PlanTransition | null> {
  const [row] = await db.select({ detail: billingEvents.detail }).from(billingEvents)
    .where(and(eq(billingEvents.organizationId, organizationId), eq(billingEvents.kind, "change.transition")))
    .orderBy(desc(billingEvents.id)).limit(1);
  return row?.detail ? row.detail as unknown as PlanTransition : null;
}

async function saveTransition(organizationId: string, state: PlanTransition, actorUserId: string | null = null) {
  await log(organizationId, actorUserId, "change.transition", { ...state });
}

async function executeTransition(organizationId: string, state: PlanTransition, now?: Date) {
  const result = await runPlanTransition(state, {
    save: next => saveTransition(organizationId, next),
    read: async () => {
      const sub = await stripe().subscriptions.retrieve(state.subscriptionId, { expand: ["schedule", "latest_invoice"] });
      return { config: currentConfig(sub), pending: Boolean(sub.pending_update),
        ended: ["canceled", "incomplete_expired"].includes(sub.status),
        scheduleId: typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id ?? null,
        invoiceUrl: typeof sub.latest_invoice === "object" ? sub.latest_invoice?.hosted_invoice_url ?? null : null };
    },
    release: async id => { await stripe().subscriptionSchedules.release(id); },
    update: async (params, key) => { await stripe().subscriptions.update(state.subscriptionId, params, { idempotencyKey: key }); },
    schedule: config => writeSchedule(state.subscriptionId, config, state.founding),
    cancelAtEnd: async cancel => {
      const sub = await stripe().subscriptions.retrieve(state.subscriptionId);
      const scheduleId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id;
      if (scheduleId) {
        await stripe().subscriptionSchedules.update(scheduleId, { end_behavior: cancel ? "cancel" : "release" });
      } else if (sub.cancel_at_period_end !== cancel) {
        await stripe().subscriptions.update(sub.id, { cancel_at_period_end: cancel });
      }
    },
    now: () => Math.floor((now?.getTime() ?? Date.now()) / 1000),
  });
  await reconcileSubscription(state.subscriptionId);
  return result;
}

/** Webhooks and the sweep resume the recorded command, never a new charge. */
export async function recoverPlanChange(organizationId: string, now?: Date) {
  return withOperationLock(organizationId, 26, async () => {
    const state = await latestTransition(organizationId);
    if (!state || state.phase === "complete" || state.phase === "aborted") return;
    await executeTransition(organizationId, state, now);
  });
}

export async function recoverPlanChanges(now = new Date()) {
  const rows = await db.execute<{ organization_id: string }>(sql`
    select organization_id from (
      select distinct on (organization_id) organization_id, detail
      from billing_events where kind = 'change.transition' and organization_id is not null
      order by organization_id, id desc
    ) latest where detail->>'phase' not in ('complete', 'aborted')
  `);
  for (const row of rows) await recoverPlanChange(row.organization_id, now).catch(error =>
    reportError("[membership] plan change needs recovery", error, { extra: { organizationId: row.organization_id } }));
}

/**
 * The next renewal's configuration, as a Stripe subscription schedule: this
 * period as it is, then one period of `next`, then released to run on.
 */
export async function writeSchedule(subscriptionId: string, next: MembershipConfig, founding: boolean) {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId, { expand: ["schedule"] });
  const attached = subscription.schedule;
  const schedule = typeof attached === "string" ? await stripe().subscriptionSchedules.retrieve(attached)
    : attached ?? await stripe().subscriptionSchedules.create({ from_subscription: subscriptionId });
  // Stripe allows only one attached schedule. A lost create response is
  // recovered from subscription.schedule. Do not reuse a create key after a
  // restored schedule was later released: Stripe would return that dead one.
  const phase = schedule.phases.find(p => p.start_date === schedule.current_phase?.start_date) ?? schedule.phases[0];
  if (!phase) throw new DomainError("Stripe didn't return the current phase.", "failed");
  const currentInterval = configOf(subscription.items.data.map((item) => item.price)).interval;

  await stripe().subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [
      {
        items: subscription.items.data.map((item) => ({
          price: item.price.id,
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
  const transition = await latestTransition(organizationId);
  if (transition && !["complete", "aborted"].includes(transition.phase)) {
    const sub = await stripe().subscriptions.retrieve(transition.subscriptionId, { expand: ["latest_invoice"] });
    // A cancellation supersedes the saved purchase. Void an unpaid upgrade so
    // paying its old link cannot resurrect it after cancellation.
    if (sub.pending_update && sub.latest_invoice) {
      const invoice = typeof sub.latest_invoice === "string"
        ? await stripe().invoices.retrieve(sub.latest_invoice) : sub.latest_invoice;
      if (invoice.status === "open") await stripe().invoices.voidInvoice(invoice.id);
    }
    await saveTransition(organizationId, { ...transition, phase: "aborted" }, actorUserId);
    await reconcileSubscription(transition.subscriptionId);
  }
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
  await requireFinishedTransition(organizationId);
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
  await requireFinishedTransition(organizationId);
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

async function requireFinishedTransition(organizationId: string) {
  const state = await latestTransition(organizationId);
  if (state && !["complete", "aborted"].includes(state.phase)) {
    throw new DomainError("A plan change is still finishing. Finish its payment or cancel the membership before changing its renewal again.", "conflict");
  }
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
