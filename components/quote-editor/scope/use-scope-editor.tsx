"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import type { ScopeActions } from "@/components/quote-editor/scope/actions";
import { AddToScope } from "@/components/quote-editor/scope/add-to-scope";
import { NodeSheet } from "@/components/quote-editor/scope/node-sheet";
import {
  cloneNode,
  dissolveNode,
  findNode,
  findParent,
  insertNode,
  makeNode,
  moveNode,
  moveTargets,
  NODE_SPEC,
  removeNode,
  reparentNode,
  replaceNode,
  retypeNode,
  walk,
  type CustomerDetail,
  type NodeType,
  type ScopeNode,
} from "@/lib/quote";
import { hasMod } from "@/lib/shortcuts";
import { emitTourEvent } from "@/lib/tours";

import type { ScopeUpdate } from "@/components/quote-editor/scope/scope-section";

export /**
 * Puts the cursor in a row's description, once React has drawn it — after an
 * add, a move, or a delete that took the focused row away.
 */
function focusRow(key: string | null) {
  if (!key) return;
  requestAnimationFrame(() => {
    const field = document.querySelector<HTMLElement>(
      `[data-node-key="${CSS.escape(key)}"] [data-row-field="description"]`
    );
    field?.focus();
  });
}

/**
 * Editing a tree of Scope rows — the verbs, the row shortcuts, the "Add to
 * scope" picker and the phone's row sheet.
 *
 * **One editor for every tree of rows.** A quote's Scope and a saved item in
 * the Library are both rows, and a row has to behave the same in both — the
 * Library's whole promise is that what lands in a quote is ordinary rows. So
 * the behaviour lives here, and each surface draws its own frame around it.
 *
 * The caller renders `overlays` inside the `ScopeActionsProvider` it gives
 * `actions` to, and puts `onRowKeyDown` on the element holding the tree.
 */
export function useScopeEditor({
  nodes,
  onScope,
  mode,
  detail = "top",
  onSaveToLibrary,
  rowExtra,
  shortcut = true,
  fixedKey,
}: {
  nodes: ScopeNode[];
  onScope: (update: ScopeUpdate) => void;
  mode: "read" | "edit";
  detail?: CustomerDetail;
  onSaveToLibrary?: (node: ScopeNode) => void;
  /** Drawn under each row in edit mode — the Library's sizing formulas. */
  rowExtra?: (node: ScopeNode) => ReactNode;
  /** Alt+N opens the picker at the top level. Off where the top level is fixed. */
  shortcut?: boolean;
  /** A row that can't be deleted from the tree — a saved item's own row. */
  fixedKey?: string;
}) {
  const [picking, setPicking] = useState<{ parentKey: string | null } | null>(
    null,
  );
  const [openKey, setOpenKey] = useState<string | null>(null);

  /**
   * The first priced row — where a tour points when it asks for a price.
   * Worked out once for the whole tree and handed down through the actions, so
   * no row has to walk the tree to find out whether it is the one.
   */
  const priceAnchorKey = useMemo(() => {
    // A priced row open in its sheet (phone) is the one being priced — the
    // row just added, usually — so the marker goes there.
    const open = openKey ? findNode(nodes, openKey) : null;
    if (open && NODE_SPEC[open.type].priced) return open.key;
    let found: string | null = null;
    walk(nodes, ({ node }) => {
      if (found === null && NODE_SPEC[node.type].priced) found = node.key;
    });
    return found;
  }, [nodes, openKey]);

  const actions = useMemo<ScopeActions>(() => {
    // Recipes run against the scope as it is when they land, not as this
    // render saw it — an Undo pressed after more typing must not roll it back.
    const apply = (recipe: (scope: ScopeNode[]) => ScopeNode[]) =>
      onScope(recipe);

    const siblingsOf = (key: string) => {
      const parent = findParent(nodes, key);
      return { parent, siblings: parent ? parent.children : nodes };
    };

    return {
      mode,
      priceAnchorKey,
      priceAnchorOpen: openKey !== null && openKey === priceAnchorKey,
      customerDetail: detail,
      rowExtra,

      patch: (key, fields) =>
        apply((scope) =>
          replaceNode(scope, key, (node) => ({ ...node, ...fields })),
        ),

      retype: (key, type) =>
        apply((scope) =>
          replaceNode(scope, key, (node) => retypeNode(node, type)),
        ),

      remove: (key) => {
        if (key === fixedKey) {
          toast.error("To remove the whole item, use Delete at the top.", { id: "fixed-row" });
          return;
        }
        const node = findNode(nodes, key);
        if (!node) return;
        const { parent, siblings } = siblingsOf(key);
        const index = siblings.findIndex((sibling) => sibling.key === key);

        apply((scope) => removeNode(scope, key));
        setOpenKey((current) => (current === key ? null : current));

        const name = NODE_SPEC[node.type].label.toLowerCase();
        const inside = node.children.length;
        toast(
          inside
            ? `Deleted the ${name} and the ${inside} row${inside === 1 ? "" : "s"} in it`
            : `Deleted the ${name}`,
          {
            // Long enough to notice the wrong row went and reach for Undo.
            duration: 10_000,
            action: {
              label: "Undo",
              onClick: () => {
                apply((scope) =>
                  insertNode(scope, node, parent?.key ?? null, index),
                );
                focusRow(node.key);
              },
            },
          },
        );
      },

      move: (key, direction) =>
        apply((scope) => moveNode(scope, key, direction)),

      position: (key) => {
        const { siblings } = siblingsOf(key);
        const index = siblings.findIndex((sibling) => sibling.key === key);
        return { first: index <= 0, last: index === siblings.length - 1 };
      },

      addBelow: (key) => {
        const current = findNode(nodes, key);
        const { parent, siblings } = siblingsOf(key);
        const index = siblings.findIndex((sibling) => sibling.key === key);
        // The row above's cost category, so a run of labor lines stays labor.
        const node = makeNode(
          "item",
          current?.section ? { section: current.section } : undefined,
        );
        apply((scope) =>
          insertNode(scope, node, parent?.key ?? null, index + 1),
        );
        focusRow(node.key);
      },

      addInside: (key) => {
        const node = makeNode("item");
        apply((scope) => insertNode(scope, node, key, null));
        focusRow(node.key);
      },

      duplicate: (key) => {
        const original = findNode(nodes, key);
        if (!original) return;
        const { parent, siblings } = siblingsOf(key);
        const index = siblings.findIndex((sibling) => sibling.key === key);
        const copy = cloneNode(original);
        apply((scope) =>
          insertNode(scope, copy, parent?.key ?? null, index + 1),
        );
        focusRow(copy.key);
      },

      moveTargets: (key) => moveTargets(nodes, key),

      moveTo: (key, parentKey) => {
        apply((scope) => reparentNode(scope, key, parentKey));
        focusRow(key);
      },

      dissolve: (key) => {
        apply((scope) => dissolveNode(scope, key));
        setOpenKey((current) => (current === key ? null : current));
      },

      /**
       * Wrapping a row in a group.
       *
       * The row is removed and re-inserted inside a fresh group at its own
       * position, so grouping never moves work to the bottom of the quote —
       * which is what "save these as a group" would look like if the group were
       * simply appended.
       */
      group: (key) =>
        apply((scope) => {
          const node = findNode(scope, key);
          if (!node) return scope;

          const parent = findParent(scope, key);
          const siblings = parent ? parent.children : scope;
          const index = siblings.findIndex((sibling) => sibling.key === key);

          const wrapper = makeNode("group", {
            description: "",
            children: [node],
          });

          return insertNode(
            removeNode(scope, key),
            wrapper,
            parent?.key ?? null,
            index,
          );
        }),

      add: (parentKey) => setPicking({ parentKey }),

      open: (key) => setOpenKey(key),

      saveToLibrary: onSaveToLibrary
        ? (key) => {
            const node = findNode(nodes, key);
            if (node) onSaveToLibrary(node);
          }
        : undefined,
    };
  }, [nodes, detail, mode, onScope, onSaveToLibrary, openKey, priceAnchorKey, rowExtra, fixedKey]);

  const openNode = openKey ? findNode(nodes, openKey) : null;
  const pickingParent = picking?.parentKey
    ? findNode(nodes, picking.parentKey)
    : null;

  const addNode = useCallback(
    (type: NodeType) => {
      const node = makeNode(type);
      onScope((scope) =>
        insertNode(scope, node, picking?.parentKey ?? null, null),
      );
      if (NODE_SPEC[type].priced) emitTourEvent("quote.priced-row-added");
      // Straight into the new row on a phone, where there is nothing else on
      // screen to type into. At the desk the cursor goes into it.
      if (mode === "read") setOpenKey(node.key);
      else focusRow(node.key);
      setPicking(null);
    },
    [mode, onScope, picking],
  );

  // Alt+N, from anywhere in the editor: the picker, landing at the end.
  useEffect(() => {
    if (!shortcut) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (!event.altKey || hasMod(event) || event.shiftKey) return;
      if (event.code !== "KeyN") return;
      event.preventDefault();
      setPicking({ parentKey: null });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  /**
   * The row shortcuts. One handler on the tree rather than one per row: the
   * row is whichever one the focused field sits in.
   */
  function onRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (mode !== "edit" || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>("[data-node-key]");
    const key = row?.dataset.nodeKey;
    if (!key) return;
    const node = findNode(nodes, key);
    if (!node) return;

    if (event.altKey && !event.shiftKey && !hasMod(event)) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        actions.move(key, event.key === "ArrowUp" ? -1 : 1);
        focusRow(key);
      }
      return;
    }

    if (
      event.altKey &&
      event.shiftKey &&
      !hasMod(event) &&
      event.key === "ArrowDown"
    ) {
      event.preventDefault();
      actions.duplicate(key);
      return;
    }

    if (
      event.altKey &&
      event.shiftKey &&
      !hasMod(event) &&
      event.key === "Backspace"
    ) {
      event.preventDefault();
      // The cursor goes to the row above, or below, or the parent — wherever
      // the next edit most likely is.
      const parent = findParent(nodes, key);
      const siblings = parent ? parent.children : nodes;
      const index = siblings.findIndex((sibling) => sibling.key === key);
      const next =
        siblings[index - 1]?.key ?? siblings[index + 1]?.key ?? parent?.key ?? null;
      actions.remove(key);
      focusRow(next);
      return;
    }

    // Enter in a one-line field of a line item, or a group's name: the next
    // line item. Text rows keep Enter for a new line.
    if (
      event.key === "Enter" &&
      !event.altKey &&
      !event.shiftKey &&
      !hasMod(event) &&
      target instanceof HTMLInputElement
    ) {
      const spec = NODE_SPEC[node.type];
      if (spec.container && target.dataset.rowField === "description") {
        event.preventDefault();
        actions.addInside(key);
      } else if (spec.priced) {
        event.preventDefault();
        actions.addBelow(key);
      }
    }
  }

  const overlays = (
    <>
      <AddToScope
        open={picking !== null}
        onOpenChange={(open) => !open && setPicking(null)}
        parentName={pickingParent?.description || null}
        onPick={addNode}
      />

      {openNode ? (
        <NodeSheet
          node={openNode}
          open
          onOpenChange={(open) => !open && setOpenKey(null)}
        />
      ) : null}
    </>
  );

  return { actions, onRowKeyDown, overlays };
}
