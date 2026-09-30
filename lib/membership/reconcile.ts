import "server-only";

import type Stripe from "stripe";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  billingAccounts,
  billingEvents,
  packEntitlements,
  stripeCustomers,
  type BillingAccount,
  type PendingChange,
  type ScheduledChange,
} from "@/lib/db/schema";
import { stripe, toDate } from "@/lib/stripe/server";
import { upsertSubscription } from "@/lib/stripe/sync";

import {
  PACK_IDS,
  catalogPrice,
  type BillingInterval,
  type PackId,
  type PaidTier,
} from "./catalog";
import { endEvaluation } from "./evaluation";
import { monthlyRecurringCents } from "./mrr";

/**
 * RECONCILIATION — Stripe's subscription, read into ServiceClerk's terms (§11.2).
 *
 * **Always from a fresh retrieve.** A webhook says *something changed*; this
 * asks Stripe what is true now and writes that, so a duplicated, late or
 * out-of-order event lands on the same answer. A Checkout success page never
 * unlocks anything on its own — it calls this too.
 */

export type ItemConfig = {
  tier: PaidTier | null;
  interval: BillingInterval | null;
  packs: PackId[];
  founding: boolean;
  priceKeys: string[];
};

type PriceLike = Pick<Stripe.Price, "lookup_key" | "metadata" | "recurring" | "id">;

/** A Stripe price in the catalog's terms — by lookup key, then by its metadata. */
export function roleOf(price: PriceLike) {
  const spec = catalogPrice(price.lookup_key);
  if (spec) return { ...spec.role, interval: spec.interval, key: spec.lookupKey };

  // A price whose lookup key moved to a newer version keeps its metadata.
  const meta = price.metadata ?? {};
  const interval = (price.recurring?.interval ?? null) as BillingInterval | null;
  if (meta.role === "core" && (meta.tier === "starter" || meta.tier === "pro")) {
    return {
      kind: "core" as const,
      tier: meta.tier as PaidTier,
      founding: meta.founding === "true",
      interval,
      key: price.lookup_key ?? price.id,
    };
  }
  if (meta.role === "pack" && meta.pack === "electrical") {
    return { kind: "pack" as const, pack: "electrical" as PackId, interval, key: price.lookup_key ?? price.id };
  }
  return null;
}

export function configOf(prices: PriceLike[]): ItemConfig {
  const config: ItemConfig = { tier: null, interval: null, packs: [], founding: false, priceKeys: [] };
  for (const price of prices) {
    const role = roleOf(price);
    if (!role) continue;
    config.priceKeys.push(role.key);
    if (role.kind === "core") {
      config.tier = role.tier;
      config.founding = role.founding;
      config.interval = role.interval;
    } else if (role.kind === "pack") {
      config.packs.push(role.pack);
      config.interval ??= role.interval;
    }
  }
  return config;
}

function priceOf(value: string | Stripe.Price | Stripe.DeletedPrice): PriceLike | null {
  if (typeof value === "string" || "deleted" in value) return null;
  return value;
}

async function organizationFor(subscription: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = subscription.metadata?.organizationId;
  if (fromMetadata) return fromMetadata;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const [row] = await db
    .select({ organizationId: stripeCustomers.organizationId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.stripeCustomerId, customerId))
    .limit(1);
  return row?.organizationId ?? null;
}

const ENDED = new Set(["canceled", "incomplete_expired"]);
const LIVE = new Set(["active", "trialing", "past_due", "unpaid"]);

export async function reconcileSubscription(subscriptionId: string): Promise<BillingAccount | null> {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId, {
    expand: ["latest_invoice", "schedule.phases.items.price", "discounts.source.coupon"],
  });
  return reconcileFrom(subscription);
}

export async function reconcileFrom(subscription: Stripe.Subscription): Promise<BillingAccount | null> {
  const organizationId = await organizationFor(subscription);
  if (!organizationId) {
    console.error(`[membership] subscription ${subscription.id} has no organization; not projected.`);
    return null;
  }

  // The plain mirror, kept for anything still reading it.
  await upsertSubscription(subscription).catch((error) =>
    console.error("[membership] mirror upsert failed:", error)
  );

  const [before] = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.organizationId, organizationId))
    .limit(1);

  const status = subscription.status;
  const ended = ENDED.has(status);

  // A finished subscription's late event must not overwrite a newer, live one.
  if (
    before?.subscriptionId &&
    before.subscriptionId !== subscription.id &&
    ended &&
    before.subscriptionStatus &&
    !ENDED.has(before.subscriptionStatus)
  ) {
    return before;
  }

  const items = subscription.items.data;
  const current = configOf(items.map((item) => item.price));
  const item = items[0];
  const periodStart = toDate(item?.current_period_start);
  const periodEnd = toDate(item?.current_period_end);

  const latest =
    subscription.latest_invoice && typeof subscription.latest_invoice !== "string"
      ? subscription.latest_invoice
      : null;

  // Paid-through is kept apart from the period (§5.3): a renewal that has not
  // been paid moves the period on and leaves this where it was.
  let paidThrough = before?.paidThrough ?? null;
  if (status === "active" || status === "trialing") paidThrough = periodEnd;
  else if (status === "past_due" || status === "unpaid") paidThrough = periodStart;
  else if (ended && subscription.ended_at) paidThrough = before?.paidThrough ?? toDate(subscription.ended_at);

  const unpaid = status === "past_due" || status === "unpaid";
  const pastDueSince = unpaid
    ? before?.subscriptionId === subscription.id && before.pastDueSince
      ? before.pastDueSince
      : periodStart
    : null;

  const pending: PendingChange | null = subscription.pending_update
    ? (() => {
        const next = configOf(
          (subscription.pending_update.subscription_items ?? []).map((row) => row.price)
        );
        return {
          invoiceId: latest && latest.status === "open" ? (latest.id ?? null) : null,
          tier: next.tier ?? current.tier ?? "starter",
          packs: next.packs,
          expiresAt: subscription.pending_update.expires_at,
        };
      })()
    : null;

  const schedule =
    subscription.schedule && typeof subscription.schedule !== "string"
      ? subscription.schedule
      : null;

  let scheduled: ScheduledChange | null = null;
  if (subscription.cancel_at_period_end || (subscription.cancel_at && periodEnd && subscription.cancel_at * 1000 <= periodEnd.getTime())) {
    scheduled = {
      effectiveAt: (periodEnd ?? new Date()).toISOString(),
      tier: null,
      interval: null,
      packs: [],
    };
  } else if (schedule && periodEnd) {
    const next = schedule.phases.find((phase) => phase.start_date * 1000 >= periodEnd.getTime() - 1000);
    if (next) {
      const config = configOf(next.items.map((row) => priceOf(row.price)).filter((p): p is PriceLike => p !== null));
      scheduled = {
        effectiveAt: new Date(next.start_date * 1000).toISOString(),
        tier: config.tier,
        interval: config.interval,
        packs: config.packs,
      };
    } else if (schedule.end_behavior === "cancel") {
      scheduled = { effectiveAt: periodEnd.toISOString(), tier: null, interval: null, packs: [] };
    }
  }

  const live = LIVE.has(status);
  const firstInvoicePaid =
    latest?.status === "paid" && latest.billing_reason === "subscription_create"
      ? toDate(latest.status_transitions?.paid_at)
      : null;
  const firstPaidAt =
    before?.firstPaidAt ?? (status === "active" || status === "trialing" ? (firstInvoicePaid ?? toDate(subscription.start_date)) : null);

  // Founding enrollment is recorded when the first invoice is paid (§6).
  let foundingStatus = before?.foundingStatus ?? "none";
  let foundingEnrolledAt = before?.foundingEnrolledAt ?? null;
  if (current.founding && (status === "active" || status === "trialing") && foundingStatus !== "reversed") {
    if (foundingStatus !== "enrolled") foundingEnrolledAt = new Date();
    foundingStatus = "enrolled";
  }

  const values = {
    organizationId,
    subscriptionId: subscription.id,
    subscriptionStatus: status,
    tier: ended || !current.tier ? ("free" as const) : current.tier,
    interval: ended ? null : current.interval,
    packs: ended ? [] : current.packs,
    priceKeys: ended ? [] : current.priceKeys,
    foundingPrice: !ended && current.founding,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    paidThrough,
    pastDueSince,
    unpaidInvoiceId: unpaid && latest && latest.status === "open" ? (latest.id ?? null) : null,
    cancelAtPeriodEnd: !ended && Boolean(scheduled && scheduled.tier === null),
    endedAt: toDate(subscription.ended_at),
    pendingChange: ended ? null : pending,
    scheduledChange: ended ? null : scheduled,
    scheduleId: ended ? null : (schedule?.id ?? (typeof subscription.schedule === "string" ? subscription.schedule : null)),
    firstPaidAt,
    paidAccessEndedAt: ended
      ? (before?.paidAccessEndedAt ?? toDate(subscription.ended_at) ?? new Date())
      : live
        ? null
        : (before?.paidAccessEndedAt ?? null),
    foundingStatus,
    foundingEnrolledAt,
    foundingHoldUntil: foundingStatus === "enrolled" ? null : (before?.foundingHoldUntil ?? null),
    foundingHoldSession: foundingStatus === "enrolled" ? null : (before?.foundingHoldSession ?? null),
    reconciledAt: new Date(),
    updatedAt: new Date(),
  } satisfies typeof billingAccounts.$inferInsert;

  const [after] = await db
    .insert(billingAccounts)
    .values(values)
    .onConflictDoUpdate({ target: billingAccounts.organizationId, set: values })
    .returning();

  await recordMrr(organizationId, ended ? 0 : monthlyRecurringCents(subscription));
  await syncPackEntitlements(organizationId, live ? values.packs : [], items);

  // A purchased pack takes over from its evaluation.
  for (const pack of values.packs) {
    if (!before?.packs.includes(pack)) await endEvaluation(organizationId, pack as PackId);
  }

  const changed = diff(before, after);
  if (changed) {
    await db.insert(billingEvents).values({
      organizationId,
      kind: "membership.reconciled",
      detail: { subscriptionId: subscription.id, ...changed },
    });
  }

  return after;
}

/**
 * What the membership brings in a month, for the admin dashboard's MRR. Kept
 * out of the Drizzle model (see the schema), so a database that hasn't had
 * drizzle/0041 yet skips it with a warning instead of failing the reconcile.
 */
async function recordMrr(organizationId: string, cents: number | null) {
  await db
    .execute(sql`update billing_accounts set mrr_cents = ${cents} where organization_id = ${organizationId}`)
    .catch((error: unknown) =>
      console.warn("[membership] MRR not recorded — has drizzle/0041_billing_mrr.sql been applied?", error)
    );
}

/** The entitlement rows other screens read, kept in step with the subscription. */
async function syncPackEntitlements(
  organizationId: string,
  packs: string[],
  items: Stripe.SubscriptionItem[]
) {
  const now = new Date();
  for (const pack of PACK_IDS) {
    const item = items.find((row) => roleOf(row.price)?.kind === "pack" && configOf([row.price]).packs.includes(pack));
    if (packs.includes(pack)) {
      await db
        .insert(packEntitlements)
        .values({ organizationId, packId: pack, stripeSubscriptionItemId: item?.id ?? null, grantedAt: now })
        .onConflictDoUpdate({
          target: [packEntitlements.organizationId, packEntitlements.packId],
          set: { stripeSubscriptionItemId: item?.id ?? null, revokedAt: null },
        });
    } else {
      await db
        .update(packEntitlements)
        .set({ revokedAt: now })
        .where(
          and(
            eq(packEntitlements.organizationId, organizationId),
            eq(packEntitlements.packId, pack),
            isNull(packEntitlements.revokedAt)
          )
        );
    }
  }
}

function diff(before: BillingAccount | undefined, after: BillingAccount) {
  const fields = ["tier", "interval", "packs", "subscriptionStatus", "cancelAtPeriodEnd", "scheduledChange", "pendingChange", "foundingStatus"] as const;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const a = JSON.stringify(before?.[field] ?? null);
    const b = JSON.stringify(after[field] ?? null);
    if (a !== b) out[field] = { from: before?.[field] ?? null, to: after[field] ?? null };
  }
  return Object.keys(out).length ? out : null;
}

/** From a finished Checkout Session — verified against the shop before it counts. */
export async function reconcileCheckoutSession(sessionId: string, organizationId: string) {
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  if (session.metadata?.organizationId !== organizationId) return null;
  if (session.mode !== "subscription" || !session.subscription) return null;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  return reconcileSubscription(subscriptionId);
}
