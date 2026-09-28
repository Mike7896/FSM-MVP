import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { documents } from "./document-spine";
import { organizations } from "./office";

/**
 * THE MEMBERSHIP — what a shop pays ServiceClerk, and what that buys.
 * Launch Billing Specification §11.2.
 *
 * **Two authorities, never confused.** Stripe is the authority on money:
 * invoices, what was collected, refunds, the subscription object. ServiceClerk
 * is the authority on access: quota use, pack visibility, evaluations, AI
 * consumption, and what a lapsed shop can still do. These tables are the
 * second half, plus a reconciled copy of the first — `billing_accounts` is
 * rewritten from a freshly retrieved Stripe subscription on every relevant
 * webhook, so no single event (duplicated, late or out of order) decides
 * access on its own.
 *
 * The older `subscriptions` / `prices` / `products` tables stay the plain
 * mirror of Stripe objects they always were; this is the policy engine's
 * reading of them.
 */

export type MembershipTier = "free" | "starter" | "pro";
export type MembershipInterval = "month" | "year";

/** A payment-requiring change Stripe is holding until its invoice is paid (§5.2). */
export type PendingChange = {
  invoiceId: string | null;
  tier: "starter" | "pro";
  packs: string[];
  /** Unix seconds — Stripe discards a pending update after about a day. */
  expiresAt: number | null;
};

/** The configuration the subscription moves to at its next renewal (§5.2). */
export type ScheduledChange = {
  /** When it takes effect — the current period's end. ISO. */
  effectiveAt: string;
  /** `null` when the whole membership ends then (paid → Free). */
  tier: "starter" | "pro" | null;
  interval: MembershipInterval | null;
  packs: string[];
};

export const billingAccounts = pgTable(
  "billing_accounts",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /* ── The subscription, as last reconciled from Stripe ───────────── */

    subscriptionId: text("subscription_id"),
    /** Stripe's own status word, kept verbatim for support and admin. */
    subscriptionStatus: text("subscription_status"),
    /**
     * The tier the subscription is *configured* for. Whether the shop may use
     * it right now also depends on `paidThrough` and grace — see
     * `lib/membership/access.ts`. Free when there is no live subscription.
     */
    tier: text("tier").$type<MembershipTier>().notNull().default("free"),
    interval: text("interval").$type<MembershipInterval>(),
    /** Packs billed on the subscription, e.g. `{electrical}`. */
    packs: text("packs").array().notNull().default(sql`'{}'::text[]`),
    /** Every lookup key on the subscription — the price version in force. */
    priceKeys: text("price_keys").array().notNull().default(sql`'{}'::text[]`),
    /** The core line is a founding price. */
    foundingPrice: boolean("founding_price").notNull().default(false),

    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    /**
     * The end of the last service period that was actually paid for.
     * **Separate from the period and from grace** (§5.3): a past-due renewal
     * moves the period forward while the paid-through time stays put.
     */
    paidThrough: timestamp("paid_through", { withTimezone: true }),
    /** When the unpaid renewal fell due. Grace runs seven days from here. */
    pastDueSince: timestamp("past_due_since", { withTimezone: true }),
    unpaidInvoiceId: text("unpaid_invoice_id"),

    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    endedAt: timestamp("ended_at", { withTimezone: true }),

    pendingChange: jsonb("pending_change").$type<PendingChange>(),
    scheduledChange: jsonb("scheduled_change").$type<ScheduledChange>(),
    scheduleId: text("schedule_id"),

    /* ── Once-per-business facts ─────────────────────────────────────── */

    /** First successful paid purchase — opens the 14-day guarantee (§5.4). */
    firstPaidAt: timestamp("first_paid_at", { withTimezone: true }),
    /** The guarantee was used. Once per business. */
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    /** When paid access last ended — starts the founding restoration window. */
    paidAccessEndedAt: timestamp("paid_access_ended_at", { withTimezone: true }),

    /* ── Founding member (§6) ────────────────────────────────────────── */

    /**
     * `held` — a checkout at a founding price is open and holds a seat;
     * `enrolled` — its first invoice was paid; `reversed` — refunded, and it
     * never comes back; `lapsed` — paid access ended outside the restoration
     * window.
     */
    foundingStatus: text("founding_status")
      .$type<"none" | "held" | "enrolled" | "reversed" | "lapsed">()
      .notNull()
      .default("none"),
    foundingHoldUntil: timestamp("founding_hold_until", { withTimezone: true }),
    foundingHoldSession: text("founding_hold_session"),
    foundingEnrolledAt: timestamp("founding_enrolled_at", { withTimezone: true }),

    /** Notices already sent, as dedupe keys — `dunning:in_123:3`, `eval:electrical:10`. */
    notices: text("notices").array().notNull().default(sql`'{}'::text[]`),

    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("billing_accounts_subscription_idx")
      .on(t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
    index("billing_accounts_founding_idx").on(t.foundingStatus),
    check(
      "billing_accounts_tier_check",
      sql`${t.tier} in ('free', 'starter', 'pro')`
    ),
  ]
);

/**
 * A pack's 14-day evaluation (§3.2). One per shop per pack, ever — the primary
 * key is the rule. `ownerEmail` lets a recreated account be recognised as the
 * same business.
 */
export const packEvaluations = pgTable(
  "pack_evaluations",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    packId: text("pack_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** Exactly 14 × 24 hours after the start. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set when a purchase ends the evaluation early. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    startedBy: uuid("started_by"),
    ownerEmail: text("owner_email"),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.packId] }),
    index("pack_evaluations_owner_idx").on(t.packId, t.ownerEmail),
  ]
);

/**
 * THE JOB ACTIVATION LEDGER (§3.1).
 *
 * A job is **activated** by its first externally usable commercial action. One
 * row per job, ever: every later send, revision or invoice on that job finds
 * the row and costs nothing. Recorded for every shop, paid or not, so a
 * mid-month downgrade uses the month's real count.
 *
 * **No foreign key to `jobs`.** Deleting an activated job must not hand the
 * slot back, and a cascade would.
 */
export const jobActivations = pgTable(
  "job_activations",
  {
    jobId: uuid("job_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** UTC calendar month the slot belongs to, `2026-09`. */
    period: text("period").notNull(),
    status: text("status").$type<"reserved" | "committed">().notNull(),
    /** What activated it — `quote_sent`, `invoice_sent`, `pdf`, … */
    action: text("action").notNull(),
    /** The reservation's owner, so only it can release the slot. */
    token: uuid("token").notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    actorUserId: uuid("actor_user_id"),
  },
  (t) => [index("job_activations_period_idx").on(t.organizationId, t.period)]
);

/**
 * Release switches (§2.2, §7.1, §14.2). A missing row is off. `config` holds
 * a release's own settings — the founding offer's launch date.
 */
export const billingReleases = pgTable("billing_releases", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  config: jsonb("config").$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: uuid("updated_by"),
});

/**
 * Who changed what about a membership, and when (§11.2 "audit actor and
 * timestamp"). Append-only. `actorUserId` is null for Stripe and the sweep.
 */
export const billingEvents = pgTable(
  "billing_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    actorUserId: uuid("actor_user_id"),
    kind: text("kind").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("billing_events_org_idx").on(t.organizationId, t.occurredAt)]
);

/**
 * THE AI CREDIT LEDGER (§7). Built now, used once AI is released.
 *
 * **Lots and movements.** A grant or a purchase is a *lot* (`lotId` null,
 * positive credits). Every other row moves credits against one lot: a reserve
 * takes them (negative), a release gives them back, a settle makes a reserve
 * final (zero), an expiry or refund removes what was left. A lot's balance is
 * its credits plus every movement pointing at it, so there is no mutable
 * balance to drift.
 */
export const aiCreditEntries = pgTable(
  "ai_credit_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind")
      .$type<
        | "grant"
        | "purchase"
        | "promo"
        | "reserve"
        | "release"
        | "settle"
        | "expire"
        | "refund"
        | "adjust"
      >()
      .notNull(),
    /** The lot a movement draws on. Null on a lot itself. */
    lotId: uuid("lot_id"),
    credits: integer("credits").notNull(),
    /** One AI action, across internal retries. */
    operationId: text("operation_id"),
    /** A grant's monthly service window — `2026-09-14`. Dedupes grants. */
    windowKey: text("window_key"),
    /** The Stripe PaymentIntent that bought a purchase lot. */
    sourceRef: text("source_ref"),
    /** What one credit of this lot cost, in hundredths of a cent. */
    unitPriceMicros: integer("unit_price_micros"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ai_credit_entries_org_idx").on(t.organizationId, t.createdAt),
    index("ai_credit_entries_lot_idx").on(t.lotId),
    uniqueIndex("ai_credit_entries_grant_unique")
      .on(t.organizationId, t.windowKey)
      .where(sql`${t.kind} = 'grant'`),
    uniqueIndex("ai_credit_entries_purchase_unique")
      .on(t.sourceRef)
      .where(sql`${t.kind} = 'purchase'`),
    uniqueIndex("ai_credit_entries_movement_unique")
      .on(t.lotId, t.operationId, t.kind)
      .where(sql`${t.operationId} is not null`),
  ]
);

/**
 * One attempt to collect a homeowner invoice online (§8.3, §11.3).
 *
 * The invoice is ServiceClerk's; the PaymentIntent is Stripe's, on the
 * contractor's connected account. This row joins them and carries what the
 * invoice needs to say about money in flight — **processing is not paid** —
 * and what ServiceClerk's fee on it has done, so a duplicate refund event can
 * never reverse the fee twice.
 */
export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    stripeAccountId: text("stripe_account_id").notNull(),
    paymentIntentId: text("payment_intent_id").unique(),
    rail: text("rail").$type<"card" | "ach">().notNull(),
    amountCents: integer("amount_cents").notNull(),
    applicationFeeCents: integer("application_fee_cents").notNull().default(0),
    status: text("status")
      .$type<
        | "awaiting"
        | "processing"
        | "succeeded"
        | "failed"
        | "canceled"
        | "refunded"
        | "disputed"
      >()
      .notNull()
      .default("awaiting"),
    /** Principal refunded to the homeowner so far, cumulative. */
    refundedCents: integer("refunded_cents").notNull().default(0),
    /** Application fee handed back so far, cumulative. */
    feeRefundedCents: integer("fee_refunded_cents").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    failureMessage: text("failure_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("payment_attempts_invoice_idx").on(t.invoiceId, t.status),
    check(
      "payment_attempts_rail_check",
      sql`${t.rail} in ('card', 'ach')`
    ),
  ]
);

export type BillingAccount = typeof billingAccounts.$inferSelect;
export type JobActivation = typeof jobActivations.$inferSelect;
export type PackEvaluation = typeof packEvaluations.$inferSelect;
export type PaymentAttempt = typeof paymentAttempts.$inferSelect;
export type AiCreditEntry = typeof aiCreditEntries.$inferSelect;
