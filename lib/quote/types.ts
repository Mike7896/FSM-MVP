/**
 * The quote editor's domain types — the one vocabulary the editor, the API and
 * the database all speak.
 *
 * **Three rules run through everything here.**
 *
 * 1. **Money is integer cents, always.** Not at the edges, not "converted on
 *    save" — the draft in the contractor's hand holds cents, the input parser
 *    produces cents, the totals are computed in cents, and the API takes cents.
 *    A dollars-somewhere/cents-elsewhere split is how a quote ends up a penny
 *    off from the invoice built from it, and this product's whole claim is that
 *    the arithmetic is right.
 *
 * 2. **Cost-bucket names are the database's names.** `material`, not
 *    "Materials". The plural title-case labels are presentation, resolved in
 *    one place (`sections.ts`) rather than mapped back and forth at each
 *    boundary.
 *
 * 3. **A Quote has five sections and only one of them varies in shape.** Header
 *    is a lookup, Pricing a calculation, Terms a derivation, Acceptance a state
 *    transition — none of them is a field on this type, because none of them is
 *    authored. Scope is, and it is the tree in `tree.ts`.
 *
 * This file is imported by client components, so it must stay free of
 * `server-only` and of anything that drags in the driver.
 */

import type { lineItemSectionEnum, lineItemSourceEnum } from "@/lib/db/schema";
import type { ScopeNode } from "./tree";

/**
 * `material | labor | equipment | permit` — the four buckets a priced row lands
 * in. **Not a section of the document**: the document's sections are Header,
 * Scope, Pricing, Terms and Acceptance. This is a property of a row, orthogonal
 * to its type, and it surfaces at the desk and in the price book rather than on
 * anything the homeowner opens.
 */
export type LineSection = (typeof lineItemSectionEnum.enumValues)[number];

/** Where a row came from. Feeds the price book's learning loop. */
export type LineSource = (typeof lineItemSourceEnum.enumValues)[number];

/**
 * The five decisions, plus the money terms that hang off decision 5.
 *
 * Held as one object because they are one thought — the contractor picks "how
 * this job is priced" once, and a Preset supplies the whole set. Splitting them
 * across the draft would make applying a preset a nine-field patch.
 */
export type QuoteTerms = {
  contractType: string | null;
  priceStructure: string | null;
  /**
   * On an itemised quote, how deep the customer sees: `top` (each top-level
   * row with its total) or `all` (every row). Null reads as `top`.
   */
  scopeDetail: string | null;
  pricingMethod: string | null;
  estimatingMethod: string | null;
  estimateClass: string | null;
  billingTrigger: string | null;
  moneyUpFront: string | null;
  /** Null means no deposit is being asked for — distinct from a 0% deposit. */
  depositPercent: number | null;
  progressBilling: string | null;
  retainagePercent: number | null;
  capCents: number | null;
  /**
   * The stages the work is billed in, when `progressBilling` is `draws`. Kept
   * while billing in stages is switched off, so switching it back on doesn't
   * lose them.
   */
  phases: QuotePhase[];
  /** How the phases split the price — by the rows each covers, or by percent. */
  phaseSplit: PhaseSplit;
};

/**
 * One stage of the work, billed when it is done.
 *
 * A top-level Scope row names its phase by `key` (`ScopeNode.phaseKey`), so a
 * phase can be renamed or reordered without the rows losing their place.
 */
export type QuotePhase = {
  key: string;
  name: string;
  /** Its share of what's left after the deposit. Read only when splitting by percent. */
  percent: number;
};

/**
 * `scope`: each phase bills what its rows are worth — a floor, a room.
 * `percent`: each phase bills a share — rough-in, trim — for work where the
 * same rows run through every stage.
 */
export type PhaseSplit = "scope" | "percent";

/**
 * The whole editable document.
 *
 * A change order is the same shape with a parent contract and a delta framing,
 * which is why `mode` lives on the editor rather than in a separate type: two
 * objects with the same attribute shape share an editor, and forking the type
 * is what would eventually fork the editor.
 *
 * **`scopeOfWork` is the narrative, `scope` is the tree.** The paragraph is
 * what the single-total projection absorbs the itemisation into, and what the
 * Contract carries as the agreed scope; the tree is how it was priced. Job-
 * specific text that is *not* the summary — an exclusion, an assumption, a
 * note — is a node in the tree, positioned where the contractor wants it read,
 * and is deliberately no longer a field here.
 */
export type QuoteDraft = {
  /** Null until the first save. The editor is usable before it exists. */
  id: string | null;
  /** `Q-0007`. Assigned by trigger on insert, so it is unknown until saved. */
  number: string | null;
  jobId: string | null;
  customerId: string | null;

  /** Typed free-hand before a Customer row exists. */
  customerName: string;
  title: string;

  /** The Scope section's opening paragraph, in plain words. */
  scopeOfWork: string;
  /** The Scope section's ordered tree of typed nodes. */
  scope: ScopeNode[];

  /** Decimal fraction, e.g. 0.0825. Null means the shop has not set one. */
  taxRate: number | null;
  terms: QuoteTerms;

  status: "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired";
  licenseId: string | null;
  packId: string | null;

  /**
   * Whether the paper ends in signature lines — the one choice Acceptance
   * offers. On, the customer accepts by signing the quote itself; off, she
   * approves with a button and signs the contract after.
   */
  signatureLines: boolean;
};

export type EditorMode = "quote" | "change-order";

/** What a change order needs that a quote does not. */
export type ChangeOrderContext = {
  parentContractId: string;
  /** The agreed amount the delta is measured against. */
  agreedPriceCents: number;
  whatChanged: string;
  /** `C-0001` — what the change is against, as the header names it. */
  contractNumber?: string | null;
};
