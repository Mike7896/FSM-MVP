/**
 * How much of the Scope tree the customer sees.
 *
 * The tree is always saved whole; this decides what of it reaches her page,
 * the PDF and the email. Two settings decide it:
 *
 * - **The quote's**, one of three — one total (no rows), the top-level rows
 *   (a group or assembly is one line with its total), or every row.
 * - **A group's or assembly's own**, which overrides the quote's for that row:
 *   show the rows inside, or keep it to one line.
 *
 * Every page that draws a quote for the customer reads its rows from
 * `customerLines`, so the editor's preview, the share page, the contract and
 * the PDF can't disagree about what she was shown.
 */

import { baseTotal, isContainer, isText, type ScopeNode } from "./tree";
import type { QuoteTerms } from "./types";

export type CustomerDetail = "total" | "top" | "all";

export const CUSTOMER_DETAILS: {
  value: CustomerDetail;
  label: string;
  blurb: string;
}[] = [
  {
    value: "top",
    label: "Top-level rows",
    blurb: "Each top-level row with its price. A group or assembly is one line with its total.",
  },
  {
    value: "all",
    label: "Every row",
    blurb: "Every row with its price, with the rows inside each group listed under it.",
  },
  {
    value: "total",
    label: "One total",
    blurb: "Your scope of work and one price. No rows.",
  },
];

/**
 * The quote's setting. One total is the single-total price structure; any
 * other structure is itemised, at the depth `scopeDetail` says.
 */
export function customerDetail(
  terms: Pick<QuoteTerms, "priceStructure" | "scopeDetail">
): CustomerDetail {
  if (terms.priceStructure === "single_total") return "total";
  return terms.scopeDetail === "all" ? "all" : "top";
}

/** The terms with the customer's detail changed — the two fields it lives in, kept in step. */
export function withCustomerDetail(
  terms: QuoteTerms,
  detail: CustomerDetail
): QuoteTerms {
  if (detail === "total") return { ...terms, priceStructure: "single_total" };
  return {
    ...terms,
    // Leaving one total goes back to itemised. A structure that isn't one
    // total is already showing rows and is kept as it is.
    priceStructure:
      !terms.priceStructure || terms.priceStructure === "single_total"
        ? "itemized"
        : terms.priceStructure,
    scopeDetail: detail,
  };
}

/** Whether the customer sees the rows inside this group or assembly. */
export function showsBreakdown(node: ScopeNode, detail: CustomerDetail): boolean {
  if (!isContainer(node) || detail === "total") return false;
  if (node.breakdown === "show") return true;
  if (node.breakdown === "hide") return false;
  return detail === "all";
}

/** Whether this row's own setting differs from what the quote would do with it. */
export function overridesQuote(node: ScopeNode, detail: CustomerDetail): boolean {
  if (!isContainer(node) || detail === "total" || !node.breakdown) return false;
  return showsBreakdown(node, detail) !== (detail === "all");
}

export type CustomerLine = {
  node: ScopeNode;
  /** 0 for a top-level row, 1 for a row inside a shown group, and so on. */
  depth: number;
  /** What it adds to the price she's agreeing to. Optional rows are held out. */
  amountCents: number;
};

/**
 * The priced rows the customer reads, in the order they were written.
 *
 * Optional rows are left out — they're offered below the total, where adding
 * one can't be mistaken for part of it — and so is unpriced text, which is
 * gathered under its own headings. Every amount shown sums to the line above
 * it, and the top-level amounts sum to the total.
 */
export function customerLines(
  scope: ScopeNode[],
  detail: CustomerDetail
): CustomerLine[] {
  if (detail === "total") return [];
  const out: CustomerLine[] = [];

  function visit(nodes: ScopeNode[], depth: number) {
    for (const node of nodes) {
      if (node.optional || isText(node)) continue;
      out.push({ node, depth, amountCents: baseTotal(node) });
      if (showsBreakdown(node, detail)) visit(node.children, depth + 1);
    }
  }

  visit(scope, 0);
  return out;
}
