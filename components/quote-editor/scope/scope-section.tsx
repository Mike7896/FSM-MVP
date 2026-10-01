"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";

import {
  ScopeActionsProvider,
  type ScopeActions,
} from "@/components/quote-editor/scope/actions";
import { AddToScope } from "@/components/quote-editor/scope/add-to-scope";
import { NodeSheet } from "@/components/quote-editor/scope/node-sheet";
import { ScopeTree } from "@/components/quote-editor/scope/scope-tree";
import { EditableParagraph } from "@/components/fields";
import {
  FIELD_LABEL,
  SECTION_PAD,
  SectionCard,
} from "@/components/quote-editor/section-heading";
import { Button } from "@/components/ui/button";
import {
  describeScope,
  dissolveNode,
  findNode,
  findParent,
  insertNode,
  makeNode,
  moveNode,
  NODE_SPEC,
  removeNode,
  replaceNode,
  retypeNode,
  walk,
  type NodeType,
  type QuoteDraft,
  type ScopeNode,
} from "@/lib/quote";
import { emitTourEvent } from "@/lib/tours";
import { cn } from "@/lib/utils";

/**
 * **Scope — the only section of the Quote that is authored, and the only one
 * whose structure varies.**
 *
 * Header is a lookup, Pricing a calculation, Terms a derivation, Acceptance a
 * state transition. Nearly all editing time lands here, which is why Scope gets
 * the screen and the other four get a line each until width buys them a rail.
 * That ratio is the design, not a layout accident.
 *
 * Two things live in this section and they are different kinds of thing:
 *
 * - **The narrative** — one paragraph, in plain words. It is what the Contract
 *   carries as the agreed scope and what the single-total projection absorbs
 *   the itemisation into, which is why it is a field on the Quote rather than a
 *   node in the tree.
 * - **The tree** — an ordered tree of typed nodes, priced and unpriced. This is
 *   what the contractor spends twenty minutes in.
 *
 * **Rows are drawn where they were authored, never gathered.** Exclusions and
 * assumptions sit wherever the contractor put them, because that is the whole
 * reason they became nodes instead of two fields at the foot of the document.
 * The homeowner's page *does* gather them under headings — but her page is a
 * projection and is allowed to reorganise; the editor is the document.
 */
export function ScopeSection({
  draft,
  onScope,
  onNarrative,
  mode,
  change = false,
}: {
  draft: QuoteDraft;
  onScope: (scope: ScopeNode[]) => void;
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
    const apply = (recipe: (scope: ScopeNode[]) => ScopeNode[]) =>
      onScope(recipe(draft.scope));

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
        apply((scope) => removeNode(scope, key));
        setOpenKey((current) => (current === key ? null : current));
      },

      move: (key, direction) =>
        apply((scope) => moveNode(scope, key, direction)),

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
      onScope(insertNode(draft.scope, node, picking?.parentKey ?? null, null));
      if (NODE_SPEC[type].priced) emitTourEvent("quote.priced-row-added");
      // Straight into the new row on a phone, where there is nothing else on
      // screen to type into. At the desk the row appears in place and the
      // cursor is already where he is looking.
      if (mode === "read") setOpenKey(node.key);
      setPicking(null);
    },
    [draft.scope, mode, onScope, picking],
  );

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
        aside={
          <span className="text-muted-foreground tabular-nums">
            {describeScope(draft.scope)}
          </span>
        }
      >
        {/* The narrative. Auto-growing rather than a fixed box, because it is a
            paragraph he re-reads while pricing and a scrollbar inside three
            lines of prose is a worse answer than a taller field.

            Scope sets its own padding because its blocks divide the card, but
            it sets the *same* padding — `SECTION_PAD` — so its insides start
            where every other section's do. */}
        <div className={cn(SECTION_PAD, "py-4 @lg:py-5 @2xl:py-6")}>
          <label className="grid gap-1.5">
            <span className={FIELD_LABEL}>
              {change ? "What's changing, and why" : "Scope of work"}
            </span>
            <EditableParagraph
              rows={3}
              className="min-h-28"
              value={draft.scopeOfWork}
              aria-label={change ? "What's changing" : "Scope of work"}
              placeholder={
                change
                  ? "Describe the change in plain words — what's being added, taken out or swapped, and why."
                  : "Describe the work in plain words — what you'll do and what's included."
              }
              onChange={(event) => onNarrative(event.target.value)}
            />
          </label>
        </div>

        {/* The tree runs edge to edge and each row pads itself with
            `SECTION_PAD`. It used to be inset by the card *and* by the row,
            which started every row's text 16px right of the narrative's and
            cost the description field the width it needed. */}
        {draft.scope.length === 0 ? (
          <p className={cn(SECTION_PAD, "text-muted-foreground pb-4 text-sm leading-relaxed @lg:pb-5 @2xl:pb-6")}>
            {change
              ? "Nothing priced yet. Add the new work here, or take a line out of the contract above."
              : "Nothing priced yet. Empty is fine — add it when you know."}
          </p>
        ) : (
          <ScopeTree nodes={draft.scope} />
        )}

        <div className={cn(SECTION_PAD, "border-t py-3.5")}>
          <Button
            variant="outline"
            size="sm"
            data-tour="quote.add-row"
            onClick={() => actions.add(null)}
          >
            <Plus className="size-3.5" />
            Add to scope
          </Button>
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
