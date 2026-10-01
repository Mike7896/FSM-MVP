import type { documentStatusEnum, documentTypeEnum } from "@/lib/db/schema/enums";

/**
 * THE ONE LOOKUP — Documents §7 and §10.
 *
 * `{type, status} → mutable`, in one place, read by the database trigger and by
 * the client. That is the whole reason this file exists as data rather than as
 * a condition written twice: **the UI has to disable exactly what the database
 * would reject.** A form that lets a contractor edit a signed contract and then
 * fails on save is worse than one that never offered the field, because he has
 * already done the work.
 *
 * The SQL side is generated from this — see `npm run documents:freeze-sql` —
 * so the two cannot drift by editing one of them.
 */

export type DocumentType = (typeof documentTypeEnum.enumValues)[number];
export type DocumentStatus = (typeof documentStatusEnum.enumValues)[number];

/**
 * Every status each type may hold, in lifecycle order.
 *
 * Closed sets, per the Object Model. A fifth quote status is a model change,
 * never a copy change.
 */
export const STATUSES: Record<DocumentType, readonly DocumentStatus[]> = {
  quote: ["draft", "sent", "viewed", "accepted", "declined", "expired"],
  contract: ["generated", "part_signed", "signed"],
  change_order: ["draft", "sent", "approved", "declined"],
  invoice: ["draft", "issued", "sent", "viewed", "paid", "void"],
};

/**
 * The status at which each document stops being editable — Documents §7.
 *
 * | Document | Mutable while | Frozen at |
 * |---|---|---|
 * | Quote | draft, sent, viewed | **accepted** |
 * | Contract | generated, part-signed | **signed** (both signatures present) |
 * | Change order | draft, sent | **approved** |
 * | Invoice | draft | **issued** |
 *
 * `declined` and `expired` quotes are deliberately *not* frozen: nothing was
 * agreed, so there is nothing to protect, and `reviseQuote` needs to read one
 * that a contractor may still have been editing when it lapsed.
 */
export const FREEZES_AT: Record<DocumentType, readonly DocumentStatus[]> = {
  quote: ["accepted"],
  contract: ["signed"],
  change_order: ["approved"],
  // `void` freezes too: a voided bill is a record that this was issued and
  // withdrawn, and editing it afterwards would erase the withdrawal.
  invoice: ["issued", "sent", "viewed", "paid", "void"],
};

/** Whether a document in this state may still be edited. */
export function isMutable(type: DocumentType, status: DocumentStatus): boolean {
  return !FREEZES_AT[type].includes(status);
}

/**
 * Columns on `documents` that keep moving after the freeze.
 *
 * **The freeze protects what was agreed, not what happened next.** A signed
 * contract's scope, sum and header are settled forever; whether the homeowner
 * has *opened* it is a fact about the world that keeps changing, and an
 * invoice's `status` has to reach `paid` and `void` after it is frozen or
 * neither is expressible.
 *
 * The design doc's trigger blocked every write once `frozen_at` was set, which
 * made voiding an issued invoice impossible — the same update it forbids is the
 * one §7 says is the correct way to void.
 */
export const MUTABLE_AFTER_FREEZE = [
  "status",
  "sent_at",
  "viewed_at",
  "updated_at",
] as const;

/**
 * The same, for the per-type side tables.
 *
 * Only the invoice has any. `gate_met_at` records that the milestone a draw
 * depends on was cleared, which happens after the bill goes out; `voided_at` is
 * the withdrawal itself.
 */
export const DETAIL_MUTABLE_AFTER_FREEZE: Record<string, readonly string[]> = {
  quote_details: [],
  contract_details: [],
  // A change order freezes *at* `approved`, and `approved_at` records the same
  // moment. Whichever of the two writes lands second would otherwise be
  // rejected by the freeze the first one triggered, which would make approving
  // a change order depend on statement order inside a transaction.
  change_order_details: ["approved_at"],
  invoice_details: ["gate_met_at", "voided_at"],
};

/**
 * Scope columns that keep moving after the freeze.
 *
 * Exactly two, and they are not an exception so much as the mechanism §4
 * requires. An allowance closes when a change-order node points at it with
 * `reference_kind = 'settles'`, and the settled amount lands **on the allowance
 * node itself** so that "has this settled" is answerable without walking every
 * change order. That node belongs to the *contract*, which is frozen — so
 * either these two columns move after the freeze or allowance settlement has
 * nowhere to write.
 */
export const SCOPE_MUTABLE_AFTER_FREEZE = [
  "allowance_settled_cents",
  "allowance_settled_at",
] as const;

/**
 * The human-facing number's prefix, per type.
 *
 * Per organization and per type, so a shop's quotes and invoices count
 * independently — Q-0007 and INV-0007 are different documents and a contractor
 * reads them as such.
 */
export const NUMBER_PREFIX: Record<DocumentType, string> = {
  quote: "Q",
  contract: "C",
  change_order: "CO",
  invoice: "INV",
};
