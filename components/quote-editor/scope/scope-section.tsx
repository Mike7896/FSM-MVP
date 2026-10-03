"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import {
  ScopeActionsProvider,
  type ScopeActions,
} from "@/components/quote-editor/scope/actions";
import { AddToScope } from "@/components/quote-editor/scope/add-to-scope";
import { NodeSheet } from "@/components/quote-editor/scope/node-sheet";
import { ScopeTree } from "@/components/quote-editor/scope/scope-tree";
import { EditableParagraph } from "@/components/fields";
import {
  FIELD_HELP,
  FIELD_LABEL,
  SECTION_PAD,
  SectionCard,
} from "@/components/quote-editor/section-heading";
import { Keys } from "@/components/shortcuts/keys";
import { Button } from "@/components/ui/button";
import {
  cloneNode,
  describeScope,
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
  type NodeType,
  type QuoteDraft,
  type ScopeNode,
} from "@/lib/quote";
import { EDITOR_KEYS, hasMod } from "@/lib/shortcuts";
import { emitTourEvent } from "@/lib/tours";
import { cn } from "@/lib/utils";

export type ScopeUpdate =
  | ScopeNode[]
  | ((scope: ScopeNode[]) => ScopeNode[]);

/**
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
 * **Scope — the work, in two parts.**
 *
 * - **The scope of work** — one paragraph, in plain words. The contract
 *   carries it as the agreed scope, and a one-number quote shows it in place
 *   of the rows.
 * - **The rows** — an ordered tree of line items, groups and notes. This is
 *   where most of the time in the editor goes.
 *
 * Rows are drawn where they were written, never gathered: an exclusion sits
 * where the contractor put it. The customer's page groups them under headings.
 */
export function ScopeSection({
  draft,
  onScope,
  onNarrative,
  mode,
  change = false,
}: {
  draft: QuoteDraft;
  onScope: (update: ScopeUpdate) => void;
  onNarrative: (value: string) => void;
  /** `read` at phone width — rows open a sheet. `edit` at the desk. */
  mode: "read" | "edit";
  /**
   * A change order's Scope: it holds the change, not the job, and its rows
   * are priced as the difference.
   */
  change?: boolean;
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
    let found: string | null = null;
    walk(draft.scope, ({ node }) => {
      if (found === null && NODE_SPEC[node.type].priced) found = node.key;
    });
    return found;
  }, [draft.scope]);

  const actions = useMemo<ScopeActions>(() => {
    // Recipes run against the scope as it is when they land, not as this
    // render saw it — an Undo pressed after more typing must not roll it back.
    const apply = (recipe: (scope: ScopeNode[]) => ScopeNode[]) =>
      onScope(recipe);

    const siblingsOf = (key: string) => {
      const parent = findParent(draft.scope, key);
      return { parent, siblings: parent ? parent.children : draft.scope };
    };

    return {
      mode,
      priceAnchorKey,

      patch: (key, fields) =>
        apply((scope) =>
          replaceNode(scope, key, (node) => ({ ...node, ...fields })),
        ),

      retype: (key, type) =>
        apply((scope) =>
          replaceNode(scope, key, (node) => retypeNode(node, type)),
        ),

      remove: (key) => {
        const node = findNode(draft.scope, key);
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
        const current = findNode(draft.scope, key);
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
        const original = findNode(draft.scope, key);
        if (!original) return;
        const { parent, siblings } = siblingsOf(key);
        const index = siblings.findIndex((sibling) => sibling.key === key);
        const copy = cloneNode(original);
        apply((scope) =>
          insertNode(scope, copy, parent?.key ?? null, index + 1),
        );
        focusRow(copy.key);
      },

      moveTargets: (key) => moveTargets(draft.scope, key),

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
    };
  }, [draft.scope, mode, onScope, priceAnchorKey]);

  const openNode = openKey ? findNode(draft.scope, openKey) : null;
  const pickingParent = picking?.parentKey
    ? findNode(draft.scope, picking.parentKey)
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
    function onKey(event: globalThis.KeyboardEvent) {
      if (!event.altKey || hasMod(event) || event.shiftKey) return;
      if (event.code !== "KeyN") return;
      event.preventDefault();
      setPicking({ parentKey: null });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    const node = findNode(draft.scope, key);
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
      const parent = findParent(draft.scope, key);
      const siblings = parent ? parent.children : draft.scope;
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

  return (
    <ScopeActionsProvider value={actions}>
      <SectionCard
        id="scope"
        hintText={
          change
            ? "What's different, row by row. Price only the difference."
            : undefined
        }
        bodyClassName="p-0 @lg:p-0 @2xl:p-0"
        hint={draft.scope.length === 0 && !draft.scopeOfWork.trim()}
      >
        {/* The paragraph — auto-growing, held to a readable line length. */}
        <div className={cn(SECTION_PAD, "py-5 @2xl:py-6")}>
          <label className="grid max-w-3xl gap-1.5">
            <span className={FIELD_LABEL}>
              {change ? "What's changing, and why" : "Scope of work"}
            </span>
            <span className={FIELD_HELP}>
              {change
                ? "The change in plain words. It goes on the change order above the rows."
                : "The job in plain words. The contract carries this as the agreed scope."}
            </span>
            <EditableParagraph
              rows={3}
              className="mt-1 min-h-28"
              value={draft.scopeOfWork}
              aria-label={change ? "What's changing" : "Scope of work"}
              placeholder={
                change
                  ? "What's being added, taken out or swapped, and why."
                  : "What you'll do and what's included."
              }
              onChange={(event) => onNarrative(event.target.value)}
            />
          </label>
        </div>

        {/* The rows: a heading of their own, so the paragraph and the priced
            work read as two parts of one section. */}
        <div
          className={cn(
            SECTION_PAD,
            "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-5 pb-3"
          )}
        >
          <div>
            <h4 className={FIELD_LABEL}>
              {change ? "Changed rows" : "Line items"}
            </h4>
            {draft.scope.length === 0 ? (
              <p className={FIELD_HELP}>
                {change
                  ? "Add the new work, or take a line out of the contract above."
                  : "Nothing yet. Empty is fine — add rows when you know."}
              </p>
            ) : null}
          </div>
          {draft.scope.length ? (
            <span className="text-muted-foreground text-[13px] tabular-nums">
              {describeScope(draft.scope)}
            </span>
          ) : null}
        </div>

        {draft.scope.length ? (
          <div onKeyDown={onRowKeyDown}>
            <ScopeTree nodes={draft.scope} />
          </div>
        ) : null}

        <div
          className={cn(
            SECTION_PAD,
            "flex flex-wrap items-center gap-3 border-t py-3.5"
          )}
        >
          <Button
            variant="outline"
            size="sm"
            data-tour="quote.add-row"
            onClick={() => actions.add(null)}
          >
            <Plus className="size-3.5" />
            Add to scope
          </Button>
          {mode === "edit" ? (
            <Keys
              keys={EDITOR_KEYS.addToScope}
              className="hidden @2xl:inline-flex"
            />
          ) : null}
        </div>
      </SectionCard>

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
    </ScopeActionsProvider>
  );
}
