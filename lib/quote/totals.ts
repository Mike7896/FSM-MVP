/**
 * The arithmetic.
 *
 * **This must agree with the SQL in `lib/queries/jobs.ts` and
 * `lib/queries/quotes.ts` line for line.** Those queries derive a Job's and a
 * Quote's money from the same rows, and if they ever disagree the contractor
 * sees one total in the editor and a different one on the job hub for the same
 * quote — the single most trust-destroying bug this product can ship.
 *
 * The three rules all four implementations hold:
 *
 * 1. **Only priced leaves carry money.** A group or an assembly takes its total
 *    from its children; adding a container's own `sell_price_cents` to the sum
 *    would double-count every rollup on the quote.
 * 2. **Optional rows are not in the price.** She may add the dryer circuit or
 *    leave it off, so it is not in the number she is agreeing to — and it is
 *    not in the margin he is judging either, or every quote looks better than
 *    it is.
 * 3. **Tax applies to rows that are `taxable` and are not labor.**
 *
 * Pure functions over a draft: no React, no I/O — so the same code runs in the
 * editor, in the share projection the homeowner reads, and on the server when a
 * Contract is generated from an accepted Quote.
 */

import { formatMoney, percentOf } from "./money";
import {
  baseTotal,
  isPriced,
  leafTotal,
  optionalTotal,
  walk,
  type ScopeNode,
} from "./tree";
import type { LineSection, QuoteDraft } from "./types";

export type QuoteTotals = {
  /** Everything in the price, before tax. Optional rows excluded. */
  subtotalCents: number;
  /** What she could add. Stated beside the total, never inside it. */
  optionalCents: number;
  /** The portion tax is charged on. */
  taxableCents: number;
  taxCents: number;
  totalCents: number;
  /** Per-bucket subtotals — the desk's margin view and the price book. */
  bySection: Record<LineSection, number>;
  /** Null when no deposit is being asked for. */
  depositCents: number | null;
  balanceCents: number;
};

export function totals(draft: QuoteDraft): QuoteTotals {
  const bySection: Record<LineSection, number> = {
    material: 0,
    labor: 0,
    equipment: 0,
    permit: 0,
  };

  let subtotalCents = 0;
  let optionalCents = 0;
  let taxableCents = 0;

  for (const node of draft.scope) {
    subtotalCents += baseTotal(node);
    optionalCents += optionalTotal(node);
  }

  // Buckets and tax read the priced leaves directly rather than the rollups,
  // because a bucket is a property of a leaf — an assembly spans several.
  walk(draft.scope, ({ node, optional }) => {
    if (optional || !isPriced(node)) return;
    const amount = leafTotal(node);
    if (node.section) bySection[node.section] += amount;
    if (node.taxable && node.section !== "labor") taxableCents += amount;
  });

  const taxCents = draft.taxRate ? Math.round(taxableCents * draft.taxRate) : 0;
  const totalCents = subtotalCents + taxCents;

  const depositPercent = draft.terms.depositPercent;
  const depositCents =
    depositPercent === null ? null : percentOf(totalCents, depositPercent);

  return {
    subtotalCents,
    optionalCents,
    taxableCents,
    taxCents,
    totalCents,
    bySection,
    depositCents,
    balanceCents: totalCents - (depositCents ?? 0),
  };
}

/**
 * What the shop actually keeps, from the rows that carry a cost.
 *
 * **Contractor register, and never rendered on anything the customer can
 * reach.** Rows with no `unitCostCents` are excluded from both sides rather
 * than counted as free, so an incomplete price book reads as "we can't tell you
 * yet" instead of as a fictitious 100% margin.
 *
 * Optional rows are out of both sides too: a line the customer has not added
 * yet cannot be counted in the margin he is judging.
 */
export function margin(draft: QuoteDraft): {
  costCents: number;
  revenueCents: number;
  marginCents: number;
  marginPercent: number | null;
  /** How much of the quote we can actually say anything about. */
  coveredCents: number;
  complete: boolean;
  /** Per bucket, for the desk's "where the money is" table. */
  byBucket: Record<LineSection, { costCents: number; priceCents: number }>;
} {
  let costCents = 0;
  let coveredCents = 0;
  let uncovered = 0;
  let priced = 0;

  const byBucket: Record<LineSection, { costCents: number; priceCents: number }> =
    {
      material: { costCents: 0, priceCents: 0 },
      labor: { costCents: 0, priceCents: 0 },
      equipment: { costCents: 0, priceCents: 0 },
      permit: { costCents: 0, priceCents: 0 },
    };

  walk(draft.scope, ({ node, optional }) => {
    if (optional || !isPriced(node)) return;
    priced += 1;

    const amount = leafTotal(node);

    if (node.unitCostCents === null) {
      uncovered += amount;
      if (node.section) byBucket[node.section].priceCents += amount;
      return;
    }

    const cost = Math.round(node.quantity * node.unitCostCents);
    costCents += cost;
    coveredCents += amount;

    if (node.section) {
      byBucket[node.section].costCents += cost;
      byBucket[node.section].priceCents += amount;
    }
  });

  const marginCents = coveredCents - costCents;

  return {
    costCents,
    revenueCents: coveredCents,
    marginCents,
    marginPercent:
      coveredCents > 0
        ? Math.round((marginCents / coveredCents) * 1000) / 10
        : null,
    coveredCents,
    complete: uncovered === 0 && priced > 0,
    byBucket,
  };
}

/**
 * The unpriced rows, grouped by the heading the homeowner reads them under.
 *
 * Exclusions and assumptions are Scope nodes rather than fields, so the
 * document has to gather them at render time. **An assumption is a condition
 * the price depends on; an exclusion is work the price does not cover.** They
 * carry real contractual weight and are not the same sentence, which is why
 * they keep separate headings rather than being pooled into one "fine print"
 * block.
 */
export function unpricedRows(draft: QuoteDraft): {
  exclusions: ScopeNode[];
  assumptions: ScopeNode[];
  notes: ScopeNode[];
} {
  const out = {
    exclusions: [] as ScopeNode[],
    assumptions: [] as ScopeNode[],
    notes: [] as ScopeNode[],
  };

  walk(draft.scope, ({ node }) => {
    if (node.type === "exclusion") out.exclusions.push(node);
    else if (node.type === "assumption") out.assumptions.push(node);
    else if (node.type === "note") out.notes.push(node);
  });

  return out;
}

/**
 * The homeowner-register sentence the money terms produce.
 *
 * The contractor reads the mechanism ("30% deposit, then two draws"); she reads
 * the consequence. Same source, different words — which is why this lives next
 * to the arithmetic rather than being typed into a template somewhere.
 */
export function termsSentence(draft: QuoteDraft, sums: QuoteTotals): string {
  const { depositCents, totalCents, balanceCents } = sums;

  // The shared formatter, not a local one rounded to whole dollars. A sentence
  // reading "$534 due today" beside a button reading "Approve & pay $534.30" is
  // two different numbers for the same money on the document the customer is
  // deciding from — and she will be the one who notices.
  const money = formatMoney;

  if (depositCents === null || depositCents === 0) {
    return `The full ${money(totalCents)} is due when the work's done and inspected.`;
  }

  if (draft.terms.progressBilling === "draws") {
    return `${money(depositCents)} due today to book the work. The rest is billed in stages as the work is done, with photos of each one.`;
  }

  return `${money(depositCents)} due today to book the work. The remaining ${money(balanceCents)} is due on completion.`;
}
