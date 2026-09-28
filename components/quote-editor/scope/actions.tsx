"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { NodeType, ScopeNode } from "@/lib/quote";

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
 * reader can see that there are eight verbs and no ninth hiding in a component.
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
  remove: (key: string) => void;
  /** Reorder among siblings. Never across levels — that is `regroup`. */
  move: (key: string, direction: -1 | 1) => void;
  /** Take a container's children out and drop the container. */
  dissolve: (key: string) => void;
  /** Wrap this node and put it inside a new group. */
  group: (key: string) => void;
  /** Open the picker, landing new rows inside `parentKey`. */
  add: (parentKey: string | null) => void;
  /** Read mode only: open this node for editing. */
  open: (key: string) => void;

  /**
   * The first priced row. Its price field carries the `quote.row-price` tour
   * marker — the tree marks the row, and whether a tour is pointing at the
   * mark is somebody else's question.
   */
  priceAnchorKey: string | null;
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
