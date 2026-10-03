/**
 * The five sections of a Quote, and the four cost buckets a priced row lands
 * in. Two different things that used to be one, and separating them is the
 * point of this file.
 *
 * **The document has five sections, always in this order** — Header, Scope,
 * Pricing, Terms, Acceptance. They differ by *who fills them in*, which is what
 * makes them an editor decomposition rather than a page layout: Header is a
 * lookup, Pricing a calculation, Terms a derivation, Acceptance a state
 * transition. Only Scope is authored, and nearly all editing time lands there.
 * That ratio is the design — Scope gets the screen, the other four get a line
 * each until width buys them a rail.
 *
 * **The cost buckets are not sections.** `material`, `labor`, `equipment`,
 * `permit` are where a priced row lands, not how the document is organised.
 * They surface at the desk on expanded rows, in the margin view and in the
 * price book — never on the customer's document, and never as the structure of
 * the editor. Calling them "sections" is what made the old editor a four-bucket
 * form rather than a tree, and Content Design has a standing rule about the
 * four words, which is why the tree's container is a **Group**.
 *
 * The frame does not change shape when the trade pack does. Sections and line
 * taxonomy are pack-supplied *content*; this ordering is structure. That
 * separation is the whole reason the trade-pack architecture exists — the
 * editor is written as though two packs are already live.
 */

import type { LineSection } from "./types";

/* ── The document's five sections ─────────────────────────────────────── */

export type DocumentSectionId =
  | "header"
  | "scope"
  | "pricing"
  | "terms"
  | "acceptance";

export type DocumentSection = {
  id: DocumentSectionId;
  label: string;
  /** What fills it in. The reason it gets the space it gets. */
  origin: "lookup" | "authored" | "computed" | "derived" | "state";
  /**
   * One line under the section's name while it's empty, where what goes in it
   * isn't obvious. Null where the section explains itself.
   */
  hint: string | null;
};

export const DOCUMENT_SECTIONS: DocumentSection[] = [
  {
    id: "header",
    label: "Header",
    origin: "lookup",
    hint: "Who it's for and who it's from. Mostly filled in for you.",
  },
  {
    id: "scope",
    label: "Scope",
    origin: "authored",
    hint: "The work, row by row. This is the part you write.",
  },
  {
    id: "pricing",
    label: "Pricing",
    origin: "computed",
    hint: null,
  },
  {
    id: "terms",
    label: "Terms",
    origin: "derived",
    hint: "What the price commits you both to, in plain words.",
  },
  {
    id: "acceptance",
    label: "Acceptance",
    origin: "state",
    hint: "The signatures, when your customer says yes.",
  },
];

export function documentSection(id: DocumentSectionId): DocumentSection {
  return DOCUMENT_SECTIONS.find((section) => section.id === id)!;
}

/* ── The four cost buckets ────────────────────────────────────────────── */

export type CostBucket = {
  id: LineSection;
  label: string;
  /** The tag that rides on an expanded row at the desk. */
  tag: string;
  /** The unit rows in this bucket usually carry, pre-filled on a new one. */
  defaultUnit: string;
  /** Labor is not taxed in most jurisdictions; the real rule is per-pack. */
  taxableByDefault: boolean;
  hint: string;
};

export const COST_BUCKETS: CostBucket[] = [
  {
    id: "material",
    label: "Material",
    tag: "MATERIAL",
    defaultUnit: "ea",
    taxableByDefault: true,
    hint: "What you buy for this job.",
  },
  {
    id: "labor",
    label: "Labor",
    tag: "LABOR",
    defaultUnit: "hr",
    taxableByDefault: false,
    hint: "Hours at your rate.",
  },
  {
    id: "equipment",
    label: "Equipment",
    tag: "EQUIPMENT",
    defaultUnit: "day",
    taxableByDefault: true,
    hint: "Rentals and anything you bring that isn't hand tools.",
  },
  {
    id: "permit",
    label: "Permit",
    tag: "PERMIT",
    defaultUnit: "ea",
    taxableByDefault: true,
    hint: "Its own line, never buried in labor.",
  },
];

export function bucketLabel(section: LineSection | null): string {
  if (!section) return "";
  return COST_BUCKETS.find((b) => b.id === section)?.label ?? section;
}

export function bucket(section: LineSection | null): CostBucket {
  return COST_BUCKETS.find((b) => b.id === section) ?? COST_BUCKETS[0];
}

/**
 * A row's number is *ours* until the contractor touches it.
 *
 * Derived from `source` rather than stored as its own flag, because a second
 * field means a second thing that can be wrong — and the moment a contractor
 * edits a rate the source genuinely becomes `typed`. That is the same fact the
 * EST badge is showing, so it should be the same field.
 */
export function isEstimated(source: string): boolean {
  return source !== "typed";
}
