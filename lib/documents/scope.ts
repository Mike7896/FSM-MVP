import type { ScopeNode } from "@/lib/db/schema";

import { buildScopeTree, type ScopeTreeNode } from "./types";

/**
 * THE ARITHMETIC, over `scope_nodes`.
 *
 * **This must agree with `lib/quote/totals.ts`, `lib/queries/jobs.ts` and
 * `lib/queries/scope-sql.ts` line for line.** Those three derive the same money
 * from the same rows, and if any two disagree the contractor sees one total in
 * the editor and a different one on the job hub for the same document — the
 * single most trust-destroying bug this product can ship.
 *
 * The three rules every implementation holds:
 *
 * 1. **Only priced leaves carry money.** A group or an assembly takes its total
 *    from its children; adding a container's own `sellPriceCents` would
 *    double-count every rollup on the document.
 * 2. **Optional rows are not in the price**, and optional is **inherited** — a
 *    material row inside an optional group is not in the number she is agreeing
 *    to, and it is not in the margin he is judging either.
 * 3. **Tax applies to rows that are `taxable` and are not labor.**
 *
 * Pure functions over rows: no React, no I/O, so the same code runs in the
 * editor, in the projection the homeowner reads, and on the server when a
 * Contract is generated from an accepted Quote.
 */

/** The node types that carry a price of their own. */
const PRICED = new Set(["item", "allowance"]);
/** The node types that take their money from their children. */
const CONTAINER = new Set(["group", "assembly"]);

export function isPriced(node: Pick<ScopeNode, "nodeType">): boolean {
  return PRICED.has(node.nodeType);
}

export function isContainer(node: Pick<ScopeNode, "nodeType">): boolean {
  return CONTAINER.has(node.nodeType);
}

/**
 * What one priced leaf is worth.
 *
 * `quantity` is `numeric` and arrives as a string; multiplying it before
 * rounding is what keeps a 2.5-hour line at the price the estimator typed
 * rather than at two hours or three.
 */
export function leafTotal(node: ScopeNode): number {
  if (!isPriced(node)) return 0;
  return Math.round(Number(node.quantity) * node.sellPriceCents);
}

export type ScopeTotals = {
  /** Everything in the price, before tax. Optional rows excluded. */
  subtotalCents: number;
  /** What she could add. Stated beside the total, never inside it. */
  optionalCents: number;
  /** The portion tax is charged on. */
  taxableCents: number;
  taxCents: number;
  totalCents: number;
  /** Per-bucket subtotals — the desk's margin view and the price book. */
  bySection: Record<"material" | "labor" | "equipment" | "permit", number>;
};

/**
 * The document's money, from its flat node array.
 *
 * Takes the flat rows rather than a tree because that is what the loader
 * returns and what a single `order by position` produces. The tree is built
 * internally only to inherit `optional` down the branches, which is the one
 * part of this arithmetic that cannot be done on a flat list.
 */
export function scopeTotals(
  nodes: readonly ScopeNode[],
  taxRate?: string | number | null
): ScopeTotals {
  const bySection: ScopeTotals["bySection"] = {
    material: 0,
    labor: 0,
    equipment: 0,
    permit: 0,
  };

  let subtotalCents = 0;
  let optionalCents = 0;
  let taxableCents = 0;

  walk(buildScopeTree(nodes), ({ node, optional }) => {
    if (!isPriced(node)) return;
    const amount = leafTotal(node);

    if (optional) {
      optionalCents += amount;
      return;
    }

    subtotalCents += amount;
    if (node.section) bySection[node.section] += amount;
    if (node.taxable && node.section !== "labor") taxableCents += amount;
  });

  const rate = taxRate === null || taxRate === undefined ? 0 : Number(taxRate);
  const taxCents = rate ? Math.round(taxableCents * rate) : 0;

  return {
    subtotalCents,
    optionalCents,
    taxableCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    bySection,
  };
}

/** Walks the tree in document order, inheriting `optional` down each branch. */
export function walk(
  nodes: readonly ScopeTreeNode[],
  visit: (entry: { node: ScopeTreeNode; depth: number; optional: boolean }) => void
): void {
  function step(list: readonly ScopeTreeNode[], depth: number, optional: boolean) {
    for (const node of list) {
      const inherited = optional || node.optional;
      visit({ node, depth, optional: inherited });
      if (node.children.length) step(node.children, depth + 1, inherited);
    }
  }
  step(nodes, 0, false);
}

/**
 * What the shop keeps, from the rows that carry a cost.
 *
 * **Contractor register, never rendered on anything the customer can reach.**
 * Rows with no `unitCostCents` are excluded from *both* sides rather than
 * counted as free, so an incomplete price book reads as "we can't tell you yet"
 * instead of as a fictitious 100% margin.
 */
export function margin(nodes: readonly ScopeNode[]): {
  costCents: number;
  revenueCents: number;
  marginCents: number;
  marginPercent: number | null;
  /** How much of the document we can say anything about at all. */
  coveredCents: number;
  complete: boolean;
} {
  let costCents = 0;
  let revenueCents = 0;
  let uncoveredCents = 0;

  walk(buildScopeTree(nodes), ({ node, optional }) => {
    if (optional || !isPriced(node)) return;

    const price = leafTotal(node);
    if (node.unitCostCents === null) {
      uncoveredCents += price;
      return;
    }

    costCents += Math.round(Number(node.quantity) * node.unitCostCents);
    revenueCents += price;
  });

  const marginCents = revenueCents - costCents;

  return {
    costCents,
    revenueCents,
    marginCents,
    marginPercent: revenueCents > 0 ? marginCents / revenueCents : null,
    coveredCents: revenueCents,
    complete: uncoveredCents === 0,
  };
}

/**
 * The sell price a markup implies, in basis points.
 *
 * Kept here so the one place that turns cost into price is the same in the
 * editor and on the server. 3500 bps = 35%; integers throughout, because a
 * markup stored as a float is a price that changes when it round-trips.
 */
export function sellPriceFrom(
  unitCostCents: number,
  markupBps: number | null
): number {
  if (!markupBps) return unitCostCents;
  return Math.round(unitCostCents * (1 + markupBps / 10_000));
}
