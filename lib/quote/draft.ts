/**
 * Making a draft, reading one back, and working out what to save.
 *
 * The editor never mutates a draft in place — every change produces a new one
 * through the helpers here and the tree ops in `tree.ts`. That is what makes
 * autosave tractable: the save layer can compare the payload it last persisted
 * against the current one and skip the round trip entirely when nothing that
 * matters moved.
 */

import { bucket } from "./sections";
import {
  NODE_SPEC,
  buildTree,
  flatten,
  nodeSection,
  type NodeType,
  type ScopeNode,
} from "./tree";
import type {
  LineSection,
  LineSource,
  PhaseSplit,
  QuotePhase,
  QuoteDraft,
  QuoteTerms,
} from "./types";

/**
 * Progress billing ships **off** by default, and so does the deposit.
 *
 * A simple job does not need draws, and offering them by default makes it look
 * complicated on the first quote a contractor ever sends. A deposit is a share
 * of his customer's money, so the percentage is his: it comes from his Settings
 * or from this quote, never from a figure picked for him.
 */
export const DEFAULT_TERMS: QuoteTerms = {
  contractType: "lump_sum",
  priceStructure: "itemized",
  // Each top-level row with its total — how every quote looked before the
  // contractor could choose.
  scopeDetail: null,
  pricingMethod: "cost_based",
  estimatingMethod: "hourly_judgment",
  estimateClass: "class_3",
  billingTrigger: "on_completion",
  moneyUpFront: "none",
  depositPercent: null,
  progressBilling: "single_final_invoice",
  retainagePercent: null,
  capCents: null,
  phases: [],
  // A room or a floor is the phase most jobs have in mind; percentages arrive
  // with the shop's own pattern when it has one.
  phaseSplit: "scope",
};

/** A phase's key — unique within its quote, and stable while the quote is edited. */
export function newPhaseKey(): string {
  return `ph-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A stored pattern as the quote's phases. A pattern written before phases had
 * keys gets positional ones; nothing can point at those yet, so any stable
 * answer will do.
 */
export function phasesFromPattern(
  pattern: Array<{ key?: string; name: string; percent: number }> | null | undefined
): QuotePhase[] {
  return (pattern ?? []).map((stage, index) => ({
    key: stage.key || `ph-${index + 1}`,
    name: stage.name,
    percent: stage.percent,
  }));
}

let keySeed = 0;

/** Client-side identity for a node that has no database row yet. */
export function newNodeKey(): string {
  keySeed += 1;
  return `new-${keySeed}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyDraft(overrides?: Partial<QuoteDraft>): QuoteDraft {
  return {
    id: null,
    number: null,
    jobId: null,
    customerId: null,
    customerName: "",
    title: "",
    scopeOfWork: "",
    scope: [],
    taxRate: null,
    terms: { ...DEFAULT_TERMS },
    status: "draft",
    licenseId: null,
    packId: null,
    signatureLines: true,
    ...overrides,
  };
}

/**
 * One Scope node of any type.
 *
 * **One constructor for seven types**, because they are seven values of one
 * attribute. The registry decides what the defaults are — whether the node
 * carries a cost bucket, whether it holds children, what unit it starts with —
 * so a new type is a table row here and nothing else.
 */
export function makeNode(
  type: NodeType,
  overrides?: Partial<ScopeNode>
): ScopeNode {
  const nodeSpec = NODE_SPEC[type];
  const config = bucket(nodeSection(type, overrides?.section ?? null));

  const node: ScopeNode = {
    key: newNodeKey(),
    id: null,
    type,
    description: "",
    section: null,
    quantity: 1,
    // A container's quantity is a label — "× 9" describing what the bundle is —
    // and unpriced text has no unit at all.
    unit: nodeSpec.bucketed ? config.defaultUnit : null,
    unitCostCents: null,
    markupPercent: null,
    sellPriceCents: 0,
    taxable: nodeSpec.bucketed ? config.taxableByDefault : false,
    optional: false,
    breakdown: null,
    phaseKey: null,
    source: "typed",
    children: [],
    ...overrides,
  };

  // Type and bucket are normalised last, unconditionally. A caller that hands a
  // note a cost bucket — or hands a priced row `undefined` — would otherwise
  // write a row the database's check constraint rejects, and the contractor
  // would meet that as a failed autosave with nothing useful in it.
  return { ...node, type, section: nodeSection(type, node.section) };
}

/**
 * A copy of a row and everything inside it — Duplicate.
 *
 * Fresh keys and no saved ids, so the copy is new rows rather than a second
 * pointer at the same ones. A change-order line that removes or settles a
 * contract line acts on it once, so the copy drops that link.
 */
export function cloneNode(node: ScopeNode): ScopeNode {
  return {
    ...node,
    key: newNodeKey(),
    id: null,
    referencesNodeId: null,
    referenceKind: null,
    children: node.children.map(cloneNode),
  };
}

/**
 * Retypes a node in place, keeping its identity, its words and its position.
 *
 * The picker's six doors cover the common case; this is the correction. A
 * contractor who wrote a note and then realises it is really an exclusion is
 * changing one attribute of one row, and the row keeps its id so the change
 * survives as an edit rather than a delete and an insert.
 */
export function retypeNode(node: ScopeNode, type: NodeType): ScopeNode {
  const target = NODE_SPEC[type];
  const section = nodeSection(type, node.section);

  return {
    ...node,
    type,
    section,
    // Money is dropped when a row stops being priced. Keeping it would leave a
    // number on a note that no total includes and every reader expects to.
    sellPriceCents: target.priced ? node.sellPriceCents : 0,
    unitCostCents: target.priced ? node.unitCostCents : null,
    markupPercent: target.priced ? node.markupPercent : null,
    taxable: target.bucketed ? node.taxable : false,
    unit: target.bucketed ? node.unit : null,
    // A leaf becoming a container keeps its empty children array; a container
    // becoming a leaf would orphan rows, so its children come with it as
    // siblings — handled by `dissolveNode` at the call site, never here.
    children: target.container ? node.children : [],
    // Only a group or an assembly has rows inside to show or hide.
    breakdown: target.container ? (node.breakdown ?? null) : null,
  };
}

/* ── Reading a persisted quote back ───────────────────────────────────── */

/** One persisted Scope node, as the API returns it — a `scope_nodes` row. */
export type QuoteRecordNode = {
  referencesNodeId?: string | null;
  referenceKind?: "deletes" | "settles" | null;

  id: string;
  parentNodeId: string | null;
  nodeType: NodeType;
  section: LineSection | null;
  description: string;
  quantity: string | number;
  unit: string | null;
  unitCostCents: number | null;
  /** Basis points, like every rate on the document spine — 3500 is 35%. */
  markupBps: number | null;
  sellPriceCents: number;
  taxable: boolean;
  optional: boolean;
  /** Groups and assemblies: show the rows inside, or one line. Null follows the quote. */
  breakdown?: "show" | "hide" | null;
  /** Top-level rows: the phase they're billed in. */
  phaseKey?: string | null;
  position: number;
  source: LineSource;
};

/** The shape the API returns for one quote. */
export type QuoteRecord = {
  id: string;
  /** Per shop and per type — `Q-0007`. */
  number: string;
  jobId: string;
  customerId: string | null;
  customerName: string | null;
  title: string | null;
  /** The Scope section's opening paragraph. */
  summary: string | null;
  taxRate: string | number | null;
  status: QuoteDraft["status"];
  /**
   * Accepted, and so immutable. The database refuses every edit to a frozen
   * document, so the editor has to know before it offers one.
   */
  frozen: boolean;
  licenseId: string | null;
  packId: string | null;
  contractType: string | null;
  priceStructure: string | null;
  scopeDetail: string | null;
  pricingMethod: string | null;
  estimatingMethod: string | null;
  estimateClass: string | null;
  billingTrigger: string | null;
  moneyUpFront: string | null;
  depositPercent: number | null;
  progressBilling: string | null;
  retainagePercent: number | null;
  capCents: number | null;
  /** The quote's phases, as stored — `quote_details.draw_pattern`. */
  drawPattern?: Array<{ key?: string; name: string; percent: number }> | null;
  phaseSplit?: PhaseSplit | null;
  signatureLines: boolean;
  scope: QuoteRecordNode[];
};

/**
 * Database rows to an editable tree.
 *
 * `numeric` columns arrive from postgres.js as **strings**, not numbers —
 * quantity and markup both come back as `"2.000"`. Coercing them here, once, is
 * what stops a string turning up in the arithmetic downstream as a
 * concatenation bug that only shows on quotes with fractional hours.
 */
export function draftFromRecord(record: QuoteRecord): QuoteDraft {
  return {
    id: record.id,
    number: record.number,
    jobId: record.jobId,
    customerId: record.customerId,
    customerName: record.customerName ?? "",
    title: record.title ?? "",
    scopeOfWork: record.summary ?? "",
    taxRate: record.taxRate === null ? null : Number(record.taxRate),
    status: record.status,
    licenseId: record.licenseId,
    packId: record.packId,
    signatureLines: record.signatureLines,
    terms: {
      contractType: record.contractType,
      priceStructure: record.priceStructure,
      scopeDetail: record.scopeDetail,
      pricingMethod: record.pricingMethod,
      estimatingMethod: record.estimatingMethod,
      estimateClass: record.estimateClass,
      billingTrigger: record.billingTrigger,
      moneyUpFront: record.moneyUpFront,
      depositPercent: record.depositPercent,
      progressBilling: record.progressBilling,
      retainagePercent: record.retainagePercent,
      capCents: record.capCents,
      phases: phasesFromPattern(record.drawPattern),
      // Stored phases with no split recorded were percentages — the only kind
      // there was.
      phaseSplit:
        record.phaseSplit ?? (record.drawPattern?.length ? "percent" : "scope"),
    },
    scope: buildTree(
      record.scope.map((node) => ({ ...node, parentId: node.parentNodeId })),
      (row) => ({
        referencesNodeId: row.referencesNodeId,
        referenceKind: row.referenceKind,
        key: row.id,
        id: row.id,
        type: row.nodeType,
        section: row.section,
        description: row.description,
        quantity: Number(row.quantity),
        unit: row.unit,
        unitCostCents: row.unitCostCents,
        // Basis points on the wire, percent in the editor — the one place the
        // two meet.
        markupPercent: row.markupBps === null ? null : row.markupBps / 100,
        sellPriceCents: row.sellPriceCents,
        taxable: row.taxable,
        optional: row.optional,
        breakdown: row.breakdown ?? null,
        phaseKey: row.parentNodeId === null ? (row.phaseKey ?? null) : null,
        source: row.source,
        children: [],
      })
    ),
  };
}

/**
 * A saved quote reused as the starting point for a new one.
 *
 * **The cheapest form the price book takes**: the fastest way to price the next
 * panel swap is the last panel swap. Identity is stripped — no quote id, no
 * job, no customer, no row ids — so nothing is written until the contractor
 * types and the first autosave creates a genuinely new document. The tree's
 * shape survives whole, which is most of what made the original worth copying.
 *
 * The customer name is deliberately *not* carried over. A duplicate is nearly
 * always the same work for a different person, and inheriting the last one's
 * name is how a quote goes out addressed to the wrong customer.
 *
 * Rows become `duplicated` rather than keeping their original source: where a
 * row came from is what the price book learns from, and a copy of an AI-drafted
 * row is not itself AI-drafted. It also stops the EST badge reappearing on
 * numbers that were already corrected once.
 */
export function draftFromTemplate(record: QuoteRecord): QuoteDraft {
  const base = draftFromRecord(record);

  function strip(nodes: ScopeNode[]): ScopeNode[] {
    return nodes.map((node) => ({
      ...node,
      key: newNodeKey(),
      id: null,
      source: "duplicated" as LineSource,
      children: strip(node.children),
    }));
  }

  return {
    ...base,
    id: null,
    number: null,
    jobId: null,
    customerId: null,
    customerName: "",
    status: "draft",
    scope: strip(base.scope),
  };
}

/* ── Writing one back ─────────────────────────────────────────────────── */

export type SaveNode = {
  id: string | null;
  /**
   * Where this row's parent sits in this same array. Null at the root.
   *
   * **An index, not an id.** A new node has no id until the server writes it,
   * so a client-supplied parent id would either be a UUID the client invented
   * or a round trip per level of nesting. The array is in document order, so a
   * parent's index is always lower than its children's and the server resolves
   * the whole tree in one pass.
   */
  parentIndex: number | null;
  nodeType: NodeType;
  section: LineSection | null;
  description: string;
  quantity: number;
  unit: string | null;
  unitCostCents: number | null;
  /** Basis points — 3500 is 35%. */
  markupBps: number | null;
  sellPriceCents: number;
  taxable: boolean;
  optional: boolean;
  /** Groups and assemblies only; null everywhere else. */
  breakdown: "show" | "hide" | null;
  /** Top-level rows only; null everywhere else. */
  phaseKey: string | null;
  position: number;
  source: LineSource;
};

/**
 * The save payload.
 *
 * Scope goes over as **the complete tree, flattened in document order**, rather
 * than as a set of per-node create/update/delete calls. A quote's rows are
 * small — tens, not thousands — and they are one document, so sending them
 * whole lets the server replace them in a single transaction and spares the
 * editor reconciling three in-flight requests that each half-applied.
 * Reordering, regrouping and reparenting, which would otherwise each be a patch
 * across every row, all come free.
 */
export type QuoteSavePayload = {
  customerName: string;
  title: string;
  summary: string;
  taxRate: number | null;
  terms: QuoteTerms;
  signatureLines: boolean;
  scope: SaveNode[];
};

/**
 * Whether a node is worth persisting.
 *
 * A blank row the contractor added and has not typed into yet is local state,
 * not content. A container is kept regardless of its own emptiness — a group
 * named "Second floor" with rows under it is the whole point — and so is any
 * node with surviving children, because dropping a parent would orphan them.
 */
function persistable(node: ScopeNode): boolean {
  if (node.children.some(persistable)) return true;
  if (node.description.trim() !== "") return true;
  return node.sellPriceCents > 0;
}

export function toSavePayload(draft: QuoteDraft): QuoteSavePayload {
  const kept = prune(draft.scope);

  return {
    customerName: draft.customerName.trim(),
    title: draft.title.trim(),
    summary: draft.scopeOfWork,
    taxRate: draft.taxRate,
    terms: draft.terms,
    signatureLines: draft.signatureLines,
    // Position is assigned from document order at the boundary rather than kept
    // in step on every reorder — the tree *is* the order, and deriving it here
    // removes a whole class of two rows both believing they are position 3.
    scope: flatten(kept).map(({ node, parentIndex }, index) => ({
      id: node.id,
      parentIndex,
      nodeType: node.type,
      referencesNodeId: node.referencesNodeId,
      referenceKind: node.referenceKind,
      section: node.section,
      description: node.description.trim(),
      quantity: node.quantity,
      unit: node.unit,
      unitCostCents: node.unitCostCents,
      markupBps:
        node.markupPercent === null ? null : Math.round(node.markupPercent * 100),
      sellPriceCents: node.sellPriceCents,
      taxable: node.taxable,
      optional: node.optional,
      breakdown: NODE_SPEC[node.type].container ? (node.breakdown ?? null) : null,
      // Only the top level is billed by phase; a row moved inside a group
      // follows the group.
      phaseKey: parentIndex === null ? (node.phaseKey ?? null) : null,
      position: index,
      source: node.source,
    })),
  };
}

function prune(nodes: ScopeNode[]): ScopeNode[] {
  return nodes
    .filter(persistable)
    .map((node) =>
      node.children.length ? { ...node, children: prune(node.children) } : node
    );
}

/**
 * The rows a save sends, in the order it sends them — the same prune and the
 * same document order as `toSavePayload`. The server writes them back in that
 * order, so the nth row here is the nth row of the response.
 */
export function persistedNodes(scope: ScopeNode[]): ScopeNode[] {
  return flatten(prune(scope)).map(({ node }) => node);
}

/**
 * The ids the server gave the rows of a draft it was sent, keyed by each row's
 * client `key`. `sent` is the draft that went out and `returned` the tree that
 * came back; they line up row for row because the server keeps the order.
 */
export function idsByKey(
  sent: ScopeNode[],
  returned: ScopeNode[]
): Map<string, string> {
  const out = persistedNodes(sent);
  const back = flatten(returned).map(({ node }) => node);
  const ids = new Map<string, string>();
  // Row counts that disagree mean the two aren't the same write; adopt nothing
  // rather than pin an id on the wrong row.
  if (out.length !== back.length) return ids;
  out.forEach((node, index) => {
    const id = back[index].id;
    if (id) ids.set(node.key, id);
  });
  return ids;
}

/** Gives each row the id `ids` holds for its key, leaving every other field as it is. */
export function withIds(scope: ScopeNode[], ids: Map<string, string>): ScopeNode[] {
  return scope.map((node) => {
    const id = ids.get(node.key) ?? node.id;
    const children = node.children.length ? withIds(node.children, ids) : node.children;
    return id === node.id && children === node.children ? node : { ...node, id, children };
  });
}

/**
 * Whether anything worth a round trip has changed.
 *
 * Compared on the save payload rather than on the draft, so that purely local
 * state — a node's client key, a blank row the contractor added and has not
 * typed into yet — never triggers a write.
 */
export function hasChanges(a: QuoteDraft, b: QuoteDraft): boolean {
  return JSON.stringify(toSavePayload(a)) !== JSON.stringify(toSavePayload(b));
}

/**
 * What a new quote starts from — the shop's defaults, applied once.
 *
 * **A default is a starting value, and this is the only place that is true.**
 * The defaults are copied into the draft at creation and the document owns its
 * copy from then on: changing the tax rate in Settings tomorrow cannot reach a
 * quote written today, because nothing reads back. That is the answer to the
 * first question a contractor asks before touching any of them.
 *
 * **The shop's answer is the only answer.** `DEFAULT_TERMS` ships no deposit,
 * so a new quote asks for none until the contractor sets one — in Settings,
 * where it lands here, or on the quote itself. Nothing is picked for him.
 *
 * A **template** is the opposite case and is not passed through here: a
 * duplicated quote carries decisions the contractor actually made on that job,
 * and overwriting them with the shop's starting values would undo the reason
 * for duplicating it.
 *
 * The standard exclusions and assumptions become **Scope nodes**, one per line.
 * That is the whole reason they are reusable text that produces job-specific
 * rows: the contractor edits, moves or deletes them for this job like any other
 * row, and a paragraph is what he would have left alone.
 */
export type OfficeStartingValues = {
  depositPercent: number | null;
  /** The shop's stages, as percentages — a new quote's phases until it has its own. */
  drawPattern?: Array<{ name: string; percent: number }> | null;
  materialMarkupPercent: string | number | null;
  laborRateCents: number | null;
  taxRate: string | number | null;
  standardExclusions: string | null;
  standardAssumptions: string | null;
};

export function applyOfficeDefaults(
  draft: QuoteDraft,
  defaults: OfficeStartingValues | null
): QuoteDraft {
  if (!defaults) return draft;

  const textNodes = [
    ...linesToNodes(defaults.standardExclusions, "exclusion"),
    ...linesToNodes(defaults.standardAssumptions, "assumption"),
  ];

  // Only where the draft has none of its own. A duplicated quote carries the
  // exclusions it was written with, and appending the shop's would double them.
  const hasText = draft.scope.some(
    (node) => node.type === "exclusion" || node.type === "assumption"
  );

  return {
    ...draft,
    taxRate:
      defaults.taxRate === null ? draft.taxRate : Number(defaults.taxRate),
    // The shop's deposit switches the deposit on as well as setting it: a
    // percentage with the switch left off is a deposit one screen shows and
    // another says isn't there.
    terms: {
      ...(defaults.depositPercent === null
        ? draft.terms
        : {
            ...draft.terms,
            moneyUpFront: "deposit",
            depositPercent: defaults.depositPercent,
          }),
      // The pattern is a starting point the quote then owns. It stays off
      // until billing in stages is switched on, and is there when it is.
      ...(defaults.drawPattern?.length && draft.terms.phases.length === 0
        ? {
            phases: defaults.drawPattern.map((stage) => ({
              key: newPhaseKey(),
              name: stage.name,
              percent: stage.percent,
            })),
            phaseSplit: "percent" as const,
          }
        : {}),
    },
    scope: hasText ? draft.scope : [...draft.scope, ...textNodes],
  };
}

function linesToNodes(
  text: string | null,
  type: "exclusion" | "assumption"
): ScopeNode[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((description) =>
      makeNode(type, { description, source: "template" })
    );
}
