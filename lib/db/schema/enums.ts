import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Every closed value set in the model.
 *
 * Status sets are closed on purpose: Content Design §7.2 fixes them, and a new
 * status is an Object Model change rather than a copy change. The app never
 * invents a sixth quote status.
 */

/* ── The shop ─────────────────────────────────────────────────────────── */

export const memberRoleEnum = pgEnum("member_role", [
  "owner",
  "admin",
  "dispatcher",
  "technician",
]);

export const licenseStatusEnum = pgEnum("license_status", [
  "active",
  "expiring",
  "expired",
]);

/** A preset either shipped with a pack or was authored by the shop. */
export const presetSourceEnum = pgEnum("preset_source", ["pack", "shop"]);

/* ── The five pricing decisions ───────────────────────────────────────── */

/**
 * Decision 1 — how the job's cost is predicted. The distinguishing property is
 * *where the time standard comes from*: the estimator's head, the shop's own
 * history, or a third-party publication. That is the hinge the price-book
 * differentiator turns on.
 */
export const estimatingMethodEnum = pgEnum("estimating_method", [
  "hourly_judgment",
  "labor_units",
  "assembly_unit_cost",
  "price_book_time",
  "parametric",
  "analogous",
  "production_rate",
]);

/**
 * Estimate class travels with the method (AACE 5 → 1, least to most defined).
 * It is what justifies the variance tolerance the terms state.
 */
export const estimateClassEnum = pgEnum("estimate_class", [
  "class_5",
  "class_4",
  "class_3",
  "class_2",
  "class_1",
]);

/** Decision 2 — cost is the floor, competition the reference, value the ceiling. */
export const pricingMethodEnum = pgEnum("pricing_method", [
  "cost_based",
  "competition_based",
  "value_based",
]);

/** Decision 3 — the shape the customer sees, independent of how it was computed. */
export const priceStructureEnum = pgEnum("price_structure", [
  "single_total",
  "itemized",
  "partitioned",
  "tiered",
  "menu",
  "two_part",
]);

/**
 * Decision 4 — who absorbs the difference when reality moves. This one does the
 * most work: it determines what the Quote commits to, and therefore most of
 * what the terms say.
 */
export const contractTypeEnum = pgEnum("contract_type", [
  "lump_sum",
  "unit_price",
  "cost_plus",
  "gmp",
  "time_and_materials",
  "flat_rate_menu",
]);

/**
 * Decision 5 is a composite rather than one value — it is several independent
 * dimensions, so it lands as several columns on the quote.
 */
export const billingTriggerEnum = pgEnum("billing_trigger", [
  "on_completion",
  "on_milestone",
  "on_percentage_complete",
  "on_schedule_of_values",
  "on_recurring_date",
]);

export const moneyUpFrontEnum = pgEnum("money_up_front", [
  "deposit",
  "mobilization",
  "none",
]);

/**
 * What opens a scheduled draw.
 *
 * A draw is not released by a date but by something happening — the work
 * finishing, an inspector signing off, the job completing. Naming the condition
 * is what lets the hub say *why* a phase is still gated rather than only that
 * it is.
 */
export const drawGateEnum = pgEnum("draw_gate", [
  "on_acceptance",
  "phase_complete",
  "inspection_passed",
  "on_completion",
]);

export const progressBillingEnum = pgEnum("progress_billing", [
  "draws",
  "progress_billing",
  "single_final_invoice",
]);

/* ── Documents ────────────────────────────────────────────────────────── */

/** One object, three moments — not three documents. */
export const invoiceTypeEnum = pgEnum("invoice_type", [
  "deposit",
  "draw",
  "final_balance",
]);

/**
 * What kind of row this is in the Scope tree.
 *
 * **Seven values of one attribute, not seven objects.** Each fails the SIP test
 * on its own — no life outside its Quote, and nobody navigates to a list of
 * notes — and passes trivially as a value here (Object Model §4.2). `group` and
 * `assembly` are the two that take children, which is what makes Scope a tree
 * rather than a list.
 *
 * `optional` is deliberately not in this set: an optional line is still a
 * priced row the customer may add or leave off, so it is a boolean column. An
 * optional *group* is meaningful, and it would have nowhere to live here.
 */
export const lineItemTypeEnum = pgEnum("line_item_type", [
  "item",
  "assembly",
  "group",
  "allowance",
  "note",
  "exclusion",
  "assumption",
]);

/**
 * The cost bucket a priced row lands in, named the way it is named on site.
 *
 * **Orthogonal to `line_item_type`**, and not a section of the document — the
 * document's five sections are Header, Scope, Pricing, Terms and Acceptance. A
 * priced row has a type and a bucket; a note has a type and no bucket; a
 * container takes its money from its children and so has neither.
 */
export const lineItemSectionEnum = pgEnum("line_item_section", [
  "material",
  "labor",
  "equipment",
  "permit",
]);

/** Where a line came from — feeds the price book's learning loop. */
export const lineItemSourceEnum = pgEnum("line_item_source", [
  "typed",
  "template",
  "duplicated",
  "price_book",
  "ai_drafted",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "card",
  "ach",
  "check",
  "cash",
  "venmo",
  "zelle",
  "other",
]);

/* ── The work ─────────────────────────────────────────────────────────── */

export const jobStatusEnum = pgEnum("job_status", [
  "quoting",
  "scheduled",
  "in_progress",
  "complete",
  "paid",
]);

/* ── Compliance ───────────────────────────────────────────────────────── */

export const permitStatusEnum = pgEnum("permit_status", [
  "not_required",
  "needed",
  "applied",
  "issued",
  "inspections_in_progress",
  "closed",
  "expired",
  "rejected",
]);

/**
 * Who pulls a permit varies by jurisdiction, and all three answers are real —
 * a homeowner-pulled permit is a supported state, not a gap in the record.
 */
export const permitPullerEnum = pgEnum("permit_puller", [
  "shop",
  "homeowner",
  "subcontractor",
]);

/** Pack-supplied in practice — rough-in and service are electrical words. */
export const inspectionTypeEnum = pgEnum("inspection_type", [
  "underground",
  "rough_in",
  "service",
  "final",
]);

export const inspectionResultEnum = pgEnum("inspection_result", [
  "scheduled",
  "passed",
  "failed",
  "cancelled",
]);

/* ── Field artifacts ──────────────────────────────────────────────────── */

export const captureKindEnum = pgEnum("capture_kind", [
  "note",
  "photo",
  "measurement",
  "audio",
]);

/* ── Billing (Stripe read-model) ──────────────────────────────────────── */

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

export const pricingIntervalEnum = pgEnum("pricing_interval", [
  "day",
  "week",
  "month",
  "year",
]);

/* ── Connectors ───────────────────────────────────────────────────────── */

/**
 * What a connection is *for*, and the slot it occupies in the Office.
 *
 * **A contractor connects one of each at most.** The kind is the slot; the
 * provider is who fills it. That is what lets "your accounting" be a stable
 * thing the product talks about while Xero or Sage replaces QuickBooks behind
 * it, and it is why no destination in the interface is named after a vendor.
 */
export const connectionKindEnum = pgEnum("connection_kind", [
  "accounting",
  "bank",
  "processor",
  "mail",
]);

/**
 * Who fills a slot.
 *
 * **Every provider here is one the contractor already has or can link without
 * changing how they get paid.** Zelle, Venmo, Cash App, cheques and cash are
 * deliberately absent: none of them exposes an API a third party can read a
 * personal account through, and inventing a connector for them would promise
 * something no code can deliver. Those arrive as a bank-feed match or as a
 * payment the contractor records — both first-class, neither a connection.
 */
export const connectionProviderEnum = pgEnum("connection_provider", [
  "quickbooks",
  "plaid",
  "square",
  "stripe_connect",
  "paypal",
  "google_mail",
]);

/**
 * Connection health, as the contractor needs it stated.
 *
 * **Silent failure corrupts books and trust**, so there is no "unknown": a
 * connection is working, needs the contractor to do something, or is broken on
 * our side. `needs_reauth` is separated from `error` because only one of them
 * has an action attached, and a page that cannot tell them apart makes every
 * problem look like ours or like theirs.
 */
export const connectionStatusEnum = pgEnum("connection_status", [
  "connected",
  "needs_reauth",
  "degraded",
  "error",
  "revoked",
]);

/** Where a queued push has got to. `dead` has stopped retrying and needs a human. */
export const syncJobStatusEnum = pgEnum("sync_job_status", [
  "pending",
  "in_flight",
  "succeeded",
  "failed",
  "dead",
]);

/**
 * THE LEDGER — Money Ledger §5.
 *
 * **Cash-only.** Every value here is money that *physically moved*. What is
 * *owed* lives in the documents — the Contract, its change orders, the invoices
 * — and is never duplicated here. That line is the whole point: an obligation
 * written in two places is two numbers that can silently disagree, and this
 * ledger exists precisely so a contractor's money never has two answers.
 *
 * Signing off the type is what a fold reads. Positive is money toward the
 * contractor, negative is money away, and the sign lives on the amount rather
 * than in a `direction` column so a fold is a `sum` and nothing else.
 *
 * The set is closed, like every other value set in the model. A ninth entry
 * type is a schema change and an accounting decision, never a convenience.
 */
export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  /** Money in, from any rail. Card, ACH, cheque, cash, Venmo, Zelle. */
  "payment_received",
  /** Money back out to the homeowner, in whole or in part. */
  "refund_issued",
  /** The issuer pulled the money back pending adjudication. */
  "chargeback_opened",
  /** The adjudication went the contractor's way and the money returned. */
  "chargeback_reversed",
  /** Stripe's cut. Real money out, but nothing the homeowner paid changes. */
  "processing_fee",
  /** Our cut. Same. */
  "application_fee",
  /** Stripe balance → the contractor's bank. Always `job_id = NULL`. */
  "payout",
  /** The escape hatch, and the only type that requires a memo. */
  "adjustment",
]);

/**
 * Where a row came from, which is what decides how it is deduplicated.
 *
 * `stripe` and `plaid_match` carry a provider id in `external_ref` and are
 * written by machines that redeliver; `manual` is a human typing what happened
 * and has no external id to key on. §7's idempotency rule only binds the first
 * two — see the partial unique index on `ledger_entries`.
 */
export const ledgerSourceEnum = pgEnum("ledger_source", [
  "stripe",
  "plaid_match",
  "manual",
]);

/**
 * A connected account's charging capability, as the contractor needs it stated.
 *
 * Stripe exposes this as a `card_payments` capability plus a requirements blob;
 * flattening it to three words is what lets the Office say *what to do* rather
 * than render a JSON object. `restricted` is separated from `pending` because
 * only one of them is waiting on Stripe rather than on the contractor.
 */
export const connectedAccountStatusEnum = pgEnum("connected_account_status", [
  /** Created, onboarding not finished. Cannot charge. */
  "onboarding",
  /** Everything submitted, Stripe still verifying. Cannot charge yet. */
  "pending",
  /** Charges enabled. The only state a pay button appears in. */
  "active",
  /** Stripe wants more before charges or payouts resume. */
  "restricted",
  /** Charges disabled outright. */
  "disabled",
]);

/* ── The document spine ───────────────────────────────────────────────── */

/**
 * The four customer-facing documents — Documents §2.
 *
 * The type column is how the code knows which side table to join, and it is
 * the reason there is one spine rather than four parent tables: share links,
 * Scope nodes, homeowner questions and draw evidence all belong to *a
 * document*, and with four parents none of them could carry a real foreign key.
 */
export const documentTypeEnum = pgEnum("document_type", [
  "quote",
  "contract",
  "change_order",
  "invoice",
]);

/**
 * Every status any document can hold — Documents §7.
 *
 * **One column, but not one open set.** The four types have four different
 * closed sets, and `documents_status_matches_type` is the check constraint that
 * keeps them apart: a quote can never be `issued`, an invoice can never be
 * `part_signed`. The design doc left this as bare `text`, which would have lost
 * every closed status set the Object Model insists on.
 *
 * Some values are shared because they mean the same thing on more than one
 * document — `draft`, `sent` and `viewed` are the same three facts about any
 * piece of paper — and duplicating them per type would make "has she looked at
 * it" four different questions.
 *
 * | Document | Statuses |
 * |---|---|
 * | Quote | draft · sent · viewed · **accepted** · declined · expired |
 * | Contract | generated · part_signed · **signed** |
 * | Change order | draft · sent · **approved** · declined |
 * | Invoice | draft · **issued** · sent · viewed · paid · void |
 *
 * The bold value in each row is where the document freezes.
 */
export const documentStatusEnum = pgEnum("document_status", [
  // Shared across types.
  "draft",
  "sent",
  "viewed",
  // Quote.
  "accepted",
  "declined",
  "expired",
  // Contract.
  "generated",
  "part_signed",
  "signed",
  // Change order.
  "approved",
  // Invoice. `overdue` is deliberately absent: it is derived from the due date
  // at read time, because a stored one needs a nightly job and the first night
  // that job fails the list is quietly wrong about who owes money.
  "issued",
  "paid",
  "void",
]);

/** How a contract's deposit is expressed. */
export const depositBasisEnum = pgEnum("deposit_basis", [
  "percent",
  "flat",
  "none",
]);

/**
 * What a change-order node does to the contracted node it points at —
 * Documents §4.
 *
 * These three edges are why the Scope structure is not strictly a tree. A
 * change-order line usually acts *on* an agreed line rather than standing
 * alone, and naming which of the three it is doing is what lets a deduct change
 * order and an allowance settlement be computed rather than typed.
 */
export const scopeReferenceKindEnum = pgEnum("scope_reference_kind", [
  /** Replaces the agreed node with this one. */
  "supersedes",
  /** Closes an allowance at a known amount. */
  "settles",
  /** Removes the agreed node from the job. */
  "deletes",
]);

/** Who signed. Two parties, and the record is per party. */
export const signaturePartyEnum = pgEnum("signature_party", [
  "contractor",
  "customer",
]);

/* ── Signing ──────────────────────────────────────────────────────────── */

/**
 * How the mark was made.
 *
 * Both are legally equivalent under ESIGN — a typed name adopted as a signature
 * is a signature — but they are not the same evidence, and a dispute packet
 * that cannot say which one this was is weaker for no reason.
 */
export const signatureKindEnum = pgEnum("signature_kind", ["drawn", "typed"]);

/**
 * How the signer proved they were entitled to sign.
 *
 * **Two genuinely different claims.** `account` means a signed-in member of the
 * shop; `share_link` means possession of an unguessable capability URL sent to
 * a named person, which is the same standard the whole homeowner experience
 * runs on and the same one the e-signature industry calls "email
 * authentication". Recording which applied is what lets an issuer weigh it.
 */
export const signatureAuthMethodEnum = pgEnum("signature_auth_method", [
  "account",
  "share_link",
]);

/* ── Tours ────────────────────────────────────────────────────────────── */

/** Where a person stands in one tour. Skipped keeps its step, so it resumes. */
export const tourStatusEnum = pgEnum("tour_status", [
  "in_progress",
  "completed",
  "skipped",
]);
