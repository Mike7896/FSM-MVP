"use client";

import { createContext, useContext, type ReactNode } from "react";

import type {
  CustomerDetail,
  MoveTarget,
  NodeType,
  ScopeNode,
} from "@/lib/quote";

/**
 * Everything that can be done to a Scope node, in one place.
 *
 * **A context rather than props threaded through the recursion.** The tree is
 * recursive, so every prop a node needs is a prop every level has to forward,
 * and the cost of that is paid twice: once in noise, and once the next time an
 * action is added and eight signatures change. Here a node takes the node and
 * its depth, and nothing else.
 *
 * The actions are also the tree's whole vocabulary. Anything the editor can do
 * to Scope is on this type, which is what makes the surface reviewable — a
 * reader can see every verb without hunting through components.
 */
export type ScopeActions = {
  /**
   * `read` draws rows that open a sheet; `edit` draws them editable in place.
   *
   * Not two components. The row shape, the badges, the indentation rail and the
   * arithmetic are identical at both widths — only the description cell changes
   * from a label to an input, and a phone and a desk that draw two different
   * trees is how the two come to disagree about what a group is.
   */
  mode: "read" | "edit";

  /** Change one node's fields. */
  patch: (key: string, fields: Partial<ScopeNode>) => void;
  /** Change what kind of row it is, keeping its words and its position. */
  retype: (key: string, type: NodeType) => void;
  /** Deletes the row, with an Undo on the toast that says so. */
  remove: (key: string) => void;
  /** Reorder among siblings. Never across levels — that is `regroup`. */
  move: (key: string, direction: -1 | 1) => void;
  /** Where the row sits among its siblings — for greying out a move that can't happen. */
  position: (key: string) => { first: boolean; last: boolean };
  /** A new line item straight after this row, in the same parent, with the cursor in it. */
  addBelow: (key: string) => void;
  /** A new line item at the end of this container, with the cursor in it. */
  addInside: (key: string) => void;
  /** A copy of the row and everything inside it, straight after it. */
  duplicate: (key: string) => void;
  /** Where "Move to" can put this row. */
  moveTargets: (key: string) => MoveTarget[];
  /** Moves the row into another group or assembly, or to the top level (`null`). */
  moveTo: (key: string, parentKey: string | null) => void;
  /** Take a container's children out and drop the container. */
  dissolve: (key: string) => void;
  /** Wrap this node and put it inside a new group. */
  group: (key: string) => void;
  /** Open the picker, landing new rows inside `parentKey`. */
  add: (parentKey: string | null) => void;
  /** Read mode only: open this node for editing. */
  open: (key: string) => void;
  /** Keep a copy of the row in the Office's Library. Absent where there's no Library. */
  saveToLibrary?: (key: string) => void;

  /**
   * How much the customer sees, quote-wide. A group's own `breakdown` overrides
   * it, set through `patch`.
   */
  customerDetail: CustomerDetail;

  /**
   * The first priced row. Its price field carries the `quote.row-price` tour
   * marker — the tree marks the row, and whether a tour is pointing at the
   * mark is somebody else's question.
   */
  priceAnchorKey: string | null;
  /**
   * Whether that row is open in its sheet (phone). Closed, the row itself
   * carries the marker, so a step about its price points at the row to tap
   * rather than waiting on a field that isn't on screen.
   */
  priceAnchorOpen: boolean;
};

const Context = createContext<ScopeActions | null>(null);

export function ScopeActionsProvider({
  value,
  children,
}: {
  value: ScopeActions;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useScopeActions(): ScopeActions {
  const actions = useContext(Context);
  if (!actions) {
    throw new Error("A Scope node was rendered outside the tree.");
  }
  return actions;
}
