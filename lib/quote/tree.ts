/**
 * Scope — **an ordered tree of typed nodes.**
 *
 * This file is the whole of that claim. Everything the editor draws over Scope
 * reads from here, and the composability the editor is judged on is a property
 * of this module rather than of the components above it.
 *
 * **Seven types are values of one attribute, not seven objects.** Each of them
 * fails the SIP test on its own — no life outside its Quote, and nobody
 * navigates to a list of notes — and passes trivially as a value of
 * `ScopeNode.type` (Object Model §4.2). The consequence that matters is
 * negative: they must never become seven editors, seven row shapes, or seven
 * branches of a menu that read as different features. `NODE_SPEC` below is the
 * single place a type is described, so adding one is a table row rather than a
 * component.
 *
 * **Type and cost bucket are orthogonal.** `type` is what kind of row this is;
 * `section` is which bucket a priced row lands in. A priced leaf has both, a
 * note has a type and no bucket, and a container has a type and gets its money
 * from its children. That is why `section` is nullable here and in the
 * database, and why the check constraint pins which types may carry one.
 *
 * **Containers own their children; Options reference them.** Containment is
 * this tree; the Option → node edge is a cross-reference and lives elsewhere,
 * which is what stops repricing a panel across three tiers from touching three
 * nodes (Quote Document Structure §4.3).
 */

import type { LineSection, LineSource } from "./types";

/* ── The type set ─────────────────────────────────────────────────────── */

/**
 * The seven values of `ScopeNode.type`.
 *
 * `optional` is deliberately **not** in this list. An optional line is still a
 * priced row that the customer may add or leave off, so it is a boolean on the
 * node — making it a type would mean an optional *group* had nowhere to live,
 * and would put a row's price and its availability into one field.
 */
export type NodeType =
  | "item"
  | "assembly"
  | "group"
  | "allowance"
  | "note"
  | "exclusion"
  | "assumption";

export const NODE_TYPES = [
  "item",
  "assembly",
  "group",
  "allowance",
  "note",
  "exclusion",
  "assumption",
] as const satisfies readonly NodeType[];

/**
 * One node of the Scope tree.
 *
 * `key` and `id` are separate for the same reason they were on the flat line:
 * `id` is the database row and is null until saved, `key` is stable client-side
 * identity that exists the moment the node appears. Keying a component on `id`
 * would remount every row the first time a draft persists, which loses focus
 * mid-typing.
 *
 * `children` is always an array, including on leaf types. A leaf with an empty
 * array and a leaf with no field are the same thing to every consumer, and one
 * of those two shapes needs no null check at every recursion.
 */
export type ScopeNode = {
  referencesNodeId?: string | null;
  referenceKind?: "deletes" | "settles" | null;

  key: string;
  id: string | null;
  type: NodeType;
  description: string;
  /** Null on containers and on unpriced rows. Enforced by `nodeSection`. */
  section: LineSection | null;
  quantity: number;
  unit: string | null;
  /** What it costs the shop. Never shown to the homeowner. */
  unitCostCents: number | null;
  markupPercent: number | null;
  /** What the customer pays per unit. Zero on containers and unpriced rows. */
  sellPriceCents: number;
  taxable: boolean;
  /** The customer may add this row or leave it off. Inherited by descendants. */
  optional: boolean;
  /**
   * Groups and assemblies only: whether the customer sees the rows inside
   * (`show`) or one line with its total (`hide`). Null or absent follows the
   * quote's own setting — see `disclosure.ts`.
   */
  breakdown?: Breakdown | null;
  /**
   * Top-level rows of a quote billed in phases by scope: the `key` of the
   * phase this row is part of. Null or unknown puts it in the last phase.
   */
  phaseKey?: string | null;
  source: LineSource;
  children: ScopeNode[];
};

export type Breakdown = "show" | "hide";

/* ── The registry ─────────────────────────────────────────────────────── */

/**
 * A door in the "Add to scope" picker.
 *
 * `order` is how often each kind gets added: a line item is most of every
 * quote and sits first.
 */
export type NodeDoor = {
  title: string;
  blurb: string;
  order: number;
};

export type NodeSpec = {
  type: NodeType;
  /**
   * The tag that rides beside the row's name. Null where the type *is* the
   * ordinary case and a badge would label every row on the quote.
   */
  badge: string | null;
  /** The kind's name, as a noun — "Line item", "Group". */
  label: string;
  /** Holds children, and takes its money from them. */
  container: boolean;
  /** Carries a price of its own. */
  priced: boolean;
  /** Lands in a cost bucket, and so must carry a `section`. */
  bucketed: boolean;
  defaultSection: LineSection | null;
  /**
   * Its own door in the picker. Null where the type is reached through another
   * type's door — `assumption` shares `note`'s, and the row menu changes one
   * into the other.
   */
  door: NodeDoor | null;
  /** The heading the homeowner reads over this row's kind of unpriced text. */
  heading: string | null;
};

export const NODE_SPEC: Record<NodeType, NodeSpec> = {
  item: {
    type: "item",
    badge: null,
    label: "Line item",
    container: false,
    priced: true,
    bucketed: true,
    defaultSection: "material",
    door: {
      order: 1,
      title: "Line item",
      blurb:
        "One priced line — material, labor, equipment or a permit fee. You set the quantity, unit and price, and it adds into the total.",
    },
    heading: null,
  },

  assembly: {
    type: "assembly",
    badge: "ASSY",
    label: "Assembly",
    container: true,
    priced: false,
    bucketed: false,
    defaultSection: null,
    door: {
      order: 2,
      title: "Assembly",
      blurb:
        "Several parts and labor sold as one line. Your customer sees a single row and price; you see the pieces it's built from.",
    },
    heading: null,
  },

  exclusion: {
    type: "exclusion",
    badge: "EXCL",
    label: "Exclusion",
    container: false,
    priced: false,
    bucketed: false,
    defaultSection: null,
    door: {
      order: 3,
      title: "Exclusion",
      blurb:
        "Work this price doesn't cover, in writing, so it can't turn into free work later. Listed under “Not included”, with no price.",
    },
    heading: "Not included",
  },

  allowance: {
    type: "allowance",
    badge: "ALLOWANCE",
    label: "Allowance",
    container: false,
    priced: true,
    bucketed: true,
    defaultSection: "material",
    door: {
      order: 4,
      title: "Allowance",
      blurb:
        "A budget for something not settled yet. It counts in the total now and gets adjusted to the real cost once that's known.",
    },
    heading: null,
  },

  group: {
    type: "group",
    badge: "GROUP",
    label: "Group",
    container: true,
    priced: false,
    bucketed: false,
    defaultSection: null,
    door: {
      order: 5,
      title: "Group",
      blurb:
        "A heading that holds related rows — by room, phase or area. The rows sit under it, and it shows their subtotal.",
    },
    heading: null,
  },

  note: {
    type: "note",
    badge: "NOTE",
    label: "Note",
    container: false,
    priced: false,
    bucketed: false,
    defaultSection: null,
    door: {
      order: 6,
      title: "Note or condition",
      blurb:
        "Text your customer reads, with no price — a note, or a condition the price depends on, like access or existing wiring.",
    },
    heading: "Please note",
  },

  assumption: {
    type: "assumption",
    badge: "ASSUM",
    label: "Condition",
    container: false,
    priced: false,
    bucketed: false,
    defaultSection: null,
    // Reached through the note door: a condition the price depends on, where
    // an exclusion is work the price does not cover.
    door: null,
    heading: "Conditions the price assumes",
  },
};

/** The six doors, in the order the picker draws them. */
export const NODE_DOORS = NODE_TYPES.map((type) => NODE_SPEC[type])
  .filter((spec): spec is NodeSpec & { door: NodeDoor } => spec.door !== null)
  .sort((a, b) => a.door.order - b.door.order);

export function spec(type: NodeType): NodeSpec {
  return NODE_SPEC[type];
}

export function isContainer(node: ScopeNode): boolean {
  return NODE_SPEC[node.type].container;
}

export function isPriced(node: ScopeNode): boolean {
  return NODE_SPEC[node.type].priced;
}

/** Unpriced text — the rows that carry contractual weight and no money. */
export function isText(node: ScopeNode): boolean {
  const s = NODE_SPEC[node.type];
  return !s.priced && !s.container;
}

/**
 * The cost bucket a node may carry, forced to null where its type may not have
 * one. Called on every write rather than trusted from the caller, because the
 * database's check constraint enforces exactly this and a violation surfaces as
 * a failed autosave with no useful message.
 */
export function nodeSection(
  type: NodeType,
  section: LineSection | null
): LineSection | null {
  return NODE_SPEC[type].bucketed ? (section ?? NODE_SPEC[type].defaultSection) : null;
}

/*
 * **Depth is not capped.** A room group holding a walls assembly holding a
 * materials assembly is ordinary estimating, and a cap made "Add inside" on the
 * fourth level quietly put the row at the top of the quote instead (Mike,
 * Oct 4 2026). The tree draws deeper levels with a tighter indent.
 */

/* ── Reading the tree ─────────────────────────────────────────────────── */

export type Visit = {
  node: ScopeNode;
  depth: number;
  parent: ScopeNode | null;
  /** True when this node or any ancestor is optional. */
  optional: boolean;
};

/** Depth-first, in document order — the order the contractor reads. */
export function walk(nodes: ScopeNode[], visit: (entry: Visit) => void): void {
  function step(list: ScopeNode[], depth: number, parent: ScopeNode | null, optional: boolean) {
    for (const node of list) {
      const inherited = optional || node.optional;
      visit({ node, depth, parent, optional: inherited });
      if (node.children.length) step(node.children, depth + 1, node, inherited);
    }
  }
  step(nodes, 0, null, false);
}

/** Every node in document order, flat. */
export function allNodes(nodes: ScopeNode[]): ScopeNode[] {
  const out: ScopeNode[] = [];
  walk(nodes, ({ node }) => out.push(node));
  return out;
}

export function findNode(nodes: ScopeNode[], key: string): ScopeNode | null {
  let found: ScopeNode | null = null;
  walk(nodes, ({ node }) => {
    if (node.key === key) found = node;
  });
  return found;
}

/** The node holding `key`, or null when it sits at the root. */
export function findParent(nodes: ScopeNode[], key: string): ScopeNode | null {
  let found: ScopeNode | null = null;
  walk(nodes, ({ node, parent }) => {
    if (node.key === key) found = parent;
  });
  return found;
}

export function depthOf(nodes: ScopeNode[], key: string): number {
  let depth = 0;
  walk(nodes, (entry) => {
    if (entry.node.key === key) depth = entry.depth;
  });
  return depth;
}

/* ── Changing the tree ────────────────────────────────────────────────── */

/**
 * Replaces one node, leaving the rest of the tree identical by reference where
 * nothing under it changed. The editor holds the draft immutably, so every edit
 * is a rebuild of the path down to the node and nothing else.
 */
export function replaceNode(
  nodes: ScopeNode[],
  key: string,
  recipe: (node: ScopeNode) => ScopeNode
): ScopeNode[] {
  let touched = false;

  function step(list: ScopeNode[]): ScopeNode[] {
    return list.map((node) => {
      if (node.key === key) {
        touched = true;
        return recipe(node);
      }
      if (!node.children.length) return node;
      const children = step(node.children);
      return children === node.children ? node : { ...node, children };
    });
  }

  const next = step(nodes);
  return touched ? next : nodes;
}

export function removeNode(nodes: ScopeNode[], key: string): ScopeNode[] {
  function step(list: ScopeNode[]): ScopeNode[] {
    const kept = list.filter((node) => node.key !== key);
    return kept.map((node) =>
      node.children.length ? { ...node, children: step(node.children) } : node
    );
  }
  return step(nodes);
}

/**
 * Puts a node in the tree.
 *
 * `parentKey` null means the root. `index` null means "at the end of that
 * parent's children" — which is where the picker lands things, because the
 * picker says where it will land ("Inside Service upgrade") and appending is
 * what that sentence promises.
 *
 * A node whose parent is missing or cannot hold children lands at the root
 * instead of being dropped. Silently discarding a row the contractor just asked
 * for is worse than putting it somewhere he can see and move.
 */
export function insertNode(
  nodes: ScopeNode[],
  node: ScopeNode,
  parentKey: string | null = null,
  index: number | null = null
): ScopeNode[] {
  // The root always accepts. There is nowhere shallower to fall back to, and
  // refusing would mean discarding a row the contractor just asked for.
  if (parentKey === null) return place(nodes, node, index);

  const parent = findNode(nodes, parentKey);
  if (!parent || !isContainer(parent)) return place(nodes, node, null);

  return replaceNode(nodes, parentKey, (current) => ({
    ...current,
    children: place(current.children, node, index),
  }));
}

function place(list: ScopeNode[], node: ScopeNode, index: number | null) {
  if (index === null || index >= list.length) return [...list, node];
  const next = [...list];
  next.splice(Math.max(0, index), 0, node);
  return next;
}

/**
 * Reorders a node among its own siblings.
 *
 * Sibling-only movement is the whole of reordering on a phone. Dragging a row
 * *between* levels is a desk gesture and a separate action ("Group these"),
 * because a drag that can both reorder and reparent is the one that puts rows
 * in the wrong place with a drag to recover.
 */
export function moveNode(
  nodes: ScopeNode[],
  key: string,
  direction: -1 | 1
): ScopeNode[] {
  function step(list: ScopeNode[]): ScopeNode[] {
    const at = list.findIndex((node) => node.key === key);

    if (at !== -1) {
      const to = at + direction;
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      [next[at], next[to]] = [next[to], next[at]];
      return next;
    }

    return list.map((node) =>
      node.children.length ? { ...node, children: step(node.children) } : node
    );
  }

  return step(nodes);
}

/** A place a row can be moved to with "Move to": a group or assembly, or the top level. */
export type MoveTarget = {
  /** The container's key, or null for the top level of the quote. */
  key: string | null;
  label: string;
  /** How far in it sits, for indenting the list. */
  depth: number;
};

/**
 * Where a row can go: every group and assembly except itself, anything inside
 * it, and the one it's already in — plus the top level when it isn't there.
 */
export function moveTargets(nodes: ScopeNode[], key: string): MoveTarget[] {
  const node = findNode(nodes, key);
  if (!node) return [];

  const inside = new Set(allNodes([node]).map((entry) => entry.key));
  const parent = findParent(nodes, key);
  const targets: MoveTarget[] = parent
    ? [{ key: null, label: "Top level of the quote", depth: 0 }]
    : [];

  walk(nodes, ({ node: candidate, depth }) => {
    if (!isContainer(candidate) || inside.has(candidate.key)) return;
    if (candidate.key === parent?.key) return;
    targets.push({
      key: candidate.key,
      label:
        candidate.description.trim() ||
        (candidate.type === "group" ? "Untitled group" : "Untitled assembly"),
      depth,
    });
  });

  return targets;
}

/** Moves a row, and everything in it, to the end of another container or of the top level. */
export function reparentNode(
  nodes: ScopeNode[],
  key: string,
  parentKey: string | null
): ScopeNode[] {
  const node = findNode(nodes, key);
  if (!node) return nodes;
  if (!moveTargets(nodes, key).some((target) => target.key === parentKey)) {
    return nodes;
  }
  return insertNode(removeNode(nodes, key), node, parentKey, null);
}

/**
 * Takes a container's children out and drops the container.
 *
 * "Break apart" on an assembly, and the same motion on a group. It exists
 * because a locked bundle on a weird job is worse than loose rows — the link to
 * the library entry is what is discarded, and the priced rows survive exactly
 * where they were.
 */
export function dissolveNode(nodes: ScopeNode[], key: string): ScopeNode[] {
  function step(list: ScopeNode[]): ScopeNode[] {
    const out: ScopeNode[] = [];
    for (const node of list) {
      if (node.key === key && node.children.length) {
        // An optional container passes its flag down as it goes, so breaking a
        // bundle apart cannot quietly move work into the price.
        out.push(
          ...node.children.map((child) =>
            node.optional ? { ...child, optional: true } : child
          )
        );
        continue;
      }
      out.push(
        node.children.length ? { ...node, children: step(node.children) } : node
      );
    }
    return out;
  }
  return step(nodes);
}

/* ── The arithmetic ───────────────────────────────────────────────────── */

/**
 * What one priced leaf comes to.
 *
 * Rounded at the line, because that is the number printed next to it. Summing
 * unrounded products and rounding once at the end produces a total that does
 * not equal the visible lines added up, and a contractor will check.
 */
export function leafTotal(node: ScopeNode): number {
  if (!isPriced(node)) return 0;
  return Math.round(node.quantity * node.sellPriceCents);
}

/**
 * What a row is worth, optional descendants included.
 *
 * Used to show "+$340" beside an optional row. **Not** what a container
 * displays as its subtotal — see `baseTotal`.
 *
 * A container takes its money entirely from its children rather than storing a
 * rollup. Nine recessed lights are one row to the customer and five cost rows
 * to the estimator, and the parent holding its own copy of $2,970 is how the
 * two come apart the first time a child's price is corrected.
 */
export function nodeTotal(node: ScopeNode): number {
  if (isContainer(node)) {
    return node.children.reduce((sum, child) => sum + nodeTotal(child), 0);
  }
  return leafTotal(node);
}

/**
 * What a row contributes to the price the customer is agreeing to.
 *
 * Zero for an optional row and everything under it. This is the number a group
 * displays as its subtotal, so that every visible number on the document sums
 * to the total — an itemised page whose lines disagree with its own total is
 * the one thing the projection cannot do.
 */
export function baseTotal(node: ScopeNode): number {
  if (node.optional) return 0;
  if (isContainer(node)) {
    return node.children.reduce((sum, child) => sum + baseTotal(child), 0);
  }
  return leafTotal(node);
}

/** What the customer could add. Everything `baseTotal` held out. */
export function optionalTotal(node: ScopeNode): number {
  if (node.optional) return nodeTotal(node);
  if (isContainer(node)) {
    return node.children.reduce((sum, child) => sum + optionalTotal(child), 0);
  }
  return 0;
}

/* ── Shape, for the surfaces that summarise it ────────────────────────── */

export type ScopeShape = {
  /** Every node, at every depth. */
  nodes: number;
  /** Rows carrying a price. */
  priced: number;
  containers: number;
  /** Unpriced text, by type — what "2 exclusions · 1 assumption" reads from. */
  text: Record<"note" | "exclusion" | "assumption", number>;
  optional: number;
  deepest: number;
};

export function shapeOf(nodes: ScopeNode[]): ScopeShape {
  const shape: ScopeShape = {
    nodes: 0,
    priced: 0,
    containers: 0,
    text: { note: 0, exclusion: 0, assumption: 0 },
    optional: 0,
    deepest: 0,
  };

  walk(nodes, ({ node, depth, optional }) => {
    shape.nodes += 1;
    shape.deepest = Math.max(shape.deepest, depth + 1);
    if (optional) shape.optional += 1;
    if (isContainer(node)) shape.containers += 1;
    else if (isPriced(node)) shape.priced += 1;
    else shape.text[node.type as "note" | "exclusion" | "assumption"] += 1;
  });

  return shape;
}

/**
 * "9 rows · 2 groups" — the one line the collapsed Scope row carries.
 *
 * Counts what a contractor would count out loud: priced rows and the containers
 * that organise them. Unpriced text is summarised on its own, under its own
 * heading, because it is a different kind of promise.
 */
export function describeScope(nodes: ScopeNode[]): string {
  const shape = shapeOf(nodes);
  if (shape.nodes === 0) return "Empty";

  const parts: string[] = [];
  const rows = shape.priced;
  if (rows) parts.push(`${rows} row${rows === 1 ? "" : "s"}`);
  if (shape.containers) {
    parts.push(`${shape.containers} group${shape.containers === 1 ? "" : "s"}`);
  }

  const unpriced =
    shape.text.note + shape.text.exclusion + shape.text.assumption;
  if (unpriced && parts.length < 2) {
    parts.push(`${unpriced} note${unpriced === 1 ? "" : "s"}`);
  }

  return parts.join(" · ") || "Empty";
}

/* ── Flattening, for the wire and the database ────────────────────────── */

/**
 * One row as it is persisted: a node plus where its parent sits in the same
 * flat list.
 *
 * **Parent is carried as an index, not an id.** A new node has no id until the
 * server writes it, so a client-supplied parent id would either be a UUID the
 * client invented or a second round trip per level of nesting. Document order
 * guarantees a parent's index is lower than any of its children's, so the
 * server can resolve the whole tree in one pass.
 */
export type FlatNode = {
  node: ScopeNode;
  parentIndex: number | null;
};

export function flatten(nodes: ScopeNode[]): FlatNode[] {
  const out: FlatNode[] = [];

  function step(list: ScopeNode[], parentIndex: number | null) {
    for (const node of list) {
      const index = out.length;
      out.push({ node, parentIndex });
      if (node.children.length) step(node.children, index);
    }
  }

  step(nodes, null);
  return out;
}

/**
 * Flat persisted rows back into a tree, in `position` order.
 *
 * Rows whose parent is missing — a corrupt write, a partially applied
 * migration — are attached to the root rather than dropped. A quote that
 * renders slightly wrong is recoverable; a quote silently missing lines is not.
 */
export function buildTree<
  T extends { id: string; parentId: string | null; position: number },
>(rows: T[], toNode: (row: T) => ScopeNode): ScopeNode[] {
  const ordered = [...rows].sort((a, b) => a.position - b.position);
  const byId = new Map<string, ScopeNode>();

  for (const row of ordered) byId.set(row.id, toNode(row));

  const roots: ScopeNode[] = [];

  for (const row of ordered) {
    const node = byId.get(row.id)!;
    const parent = row.parentId ? byId.get(row.parentId) : null;
    if (parent && parent !== node && isContainer(parent)) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}
