/**
 * How a quote's price is paid — the deposit, then each phase as it is done.
 *
 * **One plan, read everywhere.** The editor's "How you get paid", the
 * customer's page, the PDF, the contract, the job's plan written at acceptance
 * and the job hub before acceptance all read this function, so the bill a
 * phase promises on the quote is the bill the job later sends.
 *
 * **It adds up to the price, exactly.** Deposit plus every phase equals the
 * total; the last phase takes whatever rounding leaves rather than its own
 * rounded share, so a stray cent can never leave a job that cannot be fully
 * billed.
 *
 * Pure — no React, no I/O — so it runs in the contractor's browser, on the
 * customer's page and on the server alike.
 */

import { customerDetail, customerLines, type CustomerLine } from "./disclosure";
import { formatMoney } from "./money";
import { totals, type QuoteTotals } from "./totals";
import { baseTotal, isPriced, isText, leafTotal, walk, type ScopeNode } from "./tree";
import type { QuoteDraft, QuotePhase, QuoteTerms } from "./types";

export type PaymentGate = "on_acceptance" | "phase_complete" | "on_completion";

export type PlannedPayment = {
  /** The quote phase this pays for. Null for the deposit and a lone final balance. */
  phaseKey: string | null;
  name: string;
  gate: PaymentGate;
  /** What she is billed. */
  amountCents: number;
  /**
   * What the phase's rows are worth, tax included, before any deposit comes
   * off. Null where the phase isn't priced from rows.
   */
  workCents: number | null;
  /** The top-level rows this phase covers, in document order. Empty unless split by scope. */
  rows: ScopeNode[];
};

/**
 * How a deposit comes off the phase bills when the price is split by scope.
 *
 * A phase's rows are worth more than it bills whenever a deposit was paid up
 * front, because the deposit is part of the same price. This decides which
 * bills come in under their work:
 *
 * - `spread`: every phase bills the same share of its work (30% deposit → each
 *   bills 70% of what its rows are worth);
 * - `first`: the deposit comes off the first phases until it is used up;
 * - `last`: the deposit comes off the last phases, held until the end.
 */
export type DepositCredit = "spread" | "first" | "last";

/** Pending Mike's call (Oct 4 2026) — see the chat; one constant to change. */
export const DEPOSIT_CREDIT: DepositCredit = "spread";

/** Whether the quote bills in phases at all — switched on, with phases to bill. */
export function billsInPhases(terms: Pick<QuoteTerms, "progressBilling" | "phases">): boolean {
  return terms.progressBilling === "draws" && terms.phases.length > 0;
}

/** Whether the phases are priced from the rows each covers. */
export function splitsByScope(
  terms: Pick<QuoteTerms, "progressBilling" | "phases" | "phaseSplit">
): boolean {
  return billsInPhases(terms) && terms.phaseSplit === "scope";
}

/** A phase's name as the customer reads it — never blank. */
export function phaseName(phase: QuotePhase, index: number): string {
  return phase.name.trim() || `Phase ${index + 1}`;
}

/**
 * The phase a top-level row is billed in. A row with no phase, or one naming a
 * phase since deleted, goes in the last — so every row is always in exactly
 * one, and a row added after the phases were set up is billed at the end
 * until it is put somewhere else.
 */
export function phaseKeyOf(node: ScopeNode, phases: QuotePhase[]): string | null {
  if (phases.length === 0) return null;
  if (node.phaseKey && phases.some((phase) => phase.key === node.phaseKey)) {
    return node.phaseKey;
  }
  return phases[phases.length - 1].key;
}

/** The top-level rows, sorted into their phases, in phase order. */
export function rowsByPhase(
  scope: ScopeNode[],
  phases: QuotePhase[]
): { phase: QuotePhase; index: number; rows: ScopeNode[] }[] {
  return phases.map((phase, index) => ({
    phase,
    index,
    rows: scope.filter((node) => phaseKeyOf(node, phases) === phase.key),
  }));
}

export function paymentPlan(
  draft: QuoteDraft,
  sums: QuoteTotals = totals(draft)
): PlannedPayment[] {
  const { terms } = draft;
  const plan: PlannedPayment[] = [];

  const depositCents = Math.max(sums.depositCents ?? 0, 0);
  if (depositCents > 0) {
    plan.push({
      phaseKey: null,
      name: "Deposit",
      gate: "on_acceptance",
      amountCents: depositCents,
      workCents: null,
      rows: [],
    });
  }

  const rest = Math.max(sums.totalCents - depositCents, 0);

  if (!billsInPhases(terms)) {
    plan.push({
      phaseKey: null,
      name: "Final balance",
      gate: "on_completion",
      amountCents: rest,
      workCents: null,
      rows: [],
    });
    return plan;
  }

  const phases = terms.phases;
  const gateOf = (index: number): PaymentGate =>
    // The last phase is the balance at the end, and it carries the settlement.
    index === phases.length - 1 ? "on_completion" : "phase_complete";

  if (terms.phaseSplit === "scope") {
    const groups = rowsByPhase(draft.scope, phases);
    const work = phaseWork(groups.map((group) => group.rows), draft.taxRate, sums.totalCents);
    const billed = creditDeposit(work, depositCents, sums.totalCents, DEPOSIT_CREDIT);

    groups.forEach((group, index) => {
      plan.push({
        phaseKey: group.phase.key,
        name: phaseName(group.phase, index),
        gate: gateOf(index),
        amountCents: billed[index],
        workCents: work[index],
        rows: group.rows,
      });
    });
    return plan;
  }

  // By percent: each phase's share of what's left after the deposit. Shares
  // are weights, so a pattern that doesn't add to 100 still bills the whole.
  const weight = phases.reduce((sum, phase) => sum + Math.max(phase.percent, 0), 0);
  let allocated = 0;
  phases.forEach((phase, index) => {
    const last = index === phases.length - 1;
    const amountCents = last
      ? rest - allocated
      : weight > 0
        ? Math.round((rest * Math.max(phase.percent, 0)) / weight)
        : 0;
    allocated += amountCents;
    plan.push({
      phaseKey: phase.key,
      name: phaseName(phase, index),
      gate: gateOf(index),
      amountCents,
      workCents: null,
      rows: [],
    });
  });
  return plan;
}

/**
 * What each phase's rows are worth, tax included. The same rules as `totals`
 * — optional rows out, tax on taxable rows that aren't labor — with the last
 * phase absorbing the rounding so the phases sum to the total.
 */
function phaseWork(
  groups: ScopeNode[][],
  taxRate: number | null,
  totalCents: number
): number[] {
  const work = groups.map((rows) => {
    let subtotal = 0;
    let taxable = 0;
    for (const node of rows) subtotal += baseTotal(node);
    walk(rows, ({ node, optional }) => {
      if (optional || !isPriced(node)) return;
      if (node.taxable && node.section !== "labor") taxable += leafTotal(node);
    });
    return subtotal + (taxRate ? Math.round(taxable * taxRate) : 0);
  });

  if (work.length) {
    const others = work.slice(0, -1).reduce((sum, cents) => sum + cents, 0);
    work[work.length - 1] = totalCents - others;
  }
  return work;
}

/** Each phase's bill: its work, less its part of the deposit. */
function creditDeposit(
  work: number[],
  depositCents: number,
  totalCents: number,
  credit: DepositCredit
): number[] {
  if (depositCents <= 0 || work.length === 0) return [...work];
  const rest = totalCents - depositCents;

  if (credit === "spread") {
    let allocated = 0;
    return work.map((cents, index) => {
      if (index === work.length - 1) return rest - allocated;
      const share = totalCents > 0 ? Math.round((cents * rest) / totalCents) : 0;
      allocated += share;
      return share;
    });
  }

  // `first` walks forward, `last` walks back; either way the deposit is spent
  // against whole phases until there is none left.
  const billed = [...work];
  const order = billed.map((_, index) => index);
  if (credit === "last") order.reverse();
  let left = depositCents;
  for (const index of order) {
    const off = Math.min(left, Math.max(billed[index], 0));
    billed[index] -= off;
    left -= off;
    if (left <= 0) break;
  }
  return billed;
}

/** One payment of the schedule, as the customer reads it. */
export type ScheduledPayment = {
  name: string;
  /** What opens it, in her words — "When this phase is done". */
  when: string;
  amountCents: number;
};

/**
 * The payments a quote or contract asks for, in her words — **shown before she
 * decides**, so every later ask reads as scheduled rather than opportunistic.
 * One payment is just the total again, said twice, so it is no schedule at all.
 */
export function paymentSchedule(
  draft: QuoteDraft,
  plan: PlannedPayment[] = paymentPlan(draft)
): ScheduledPayment[] {
  if (plan.length < 2) return [];
  const percent = draft.terms.depositPercent;
  return plan.map((payment) => ({
    name: payment.name,
    // The deposit is a share of the whole price, and she should see which.
    when:
      payment.gate === "on_acceptance" && percent
        ? `${PAYMENT_WHEN.on_acceptance} · ${percent}% of the total`
        : PAYMENT_WHEN[payment.gate],
    amountCents: payment.amountCents,
  }));
}

/** "When it's done" — when a payment is asked for, in her words. */
export const PAYMENT_WHEN: Record<PaymentGate, string> = {
  on_acceptance: "When you approve this",
  phase_complete: "When this phase is done",
  on_completion: "When the work's finished",
};

/**
 * The scope as she reads it when the price is split by scope: one section per
 * phase, each with its rows and what it bills when it's done — the scope
 * broken into paragraphs, the way a written proposal would be.
 *
 * Empty when the quote doesn't split by scope, which is every surface's cue to
 * draw the scope as one list.
 */
export type PhaseSection = {
  key: string;
  /** "Phase 1 · First floor". */
  heading: string;
  /** The rows she's shown, at the depth the quote shows them. */
  lines: CustomerLine[];
  /** On a one-total quote, which shows no rows: what the phase covers, by name. */
  names: string[];
  /** What it bills when it's done. */
  billedCents: number;
  /** When it bills, in her words. */
  when: string;
  /** "Your deposit covers the other $132." — when the bill is less than the work. */
  note: string | null;
};

export function phaseSections(
  draft: QuoteDraft,
  plan: PlannedPayment[] = paymentPlan(draft)
): PhaseSection[] {
  if (!splitsByScope(draft.terms)) return [];
  const detail = customerDetail(draft.terms);

  return plan
    .filter((payment) => payment.phaseKey !== null)
    .map((payment, index) => {
      const covered =
        payment.workCents !== null && payment.workCents > payment.amountCents
          ? payment.workCents - payment.amountCents
          : 0;
      const named = draft.terms.phases.find((phase) => phase.key === payment.phaseKey);
      return {
        key: payment.phaseKey!,
        heading: named?.name.trim()
          ? `Phase ${index + 1} · ${named.name.trim()}`
          : `Phase ${index + 1}`,
        lines: customerLines(payment.rows, detail),
        names:
          detail === "total"
            ? payment.rows
                .filter((node) => !node.optional && !isText(node))
                .map((node) => node.description.trim() || "Work")
            : [],
        billedCents: payment.amountCents,
        when: PAYMENT_WHEN[payment.gate],
        note: covered > 0 ? `Your deposit covers the other ${formatMoney(covered)}.` : null,
      };
    });
}
