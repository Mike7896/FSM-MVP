"use client";

import { useState, type DragEvent } from "react";
import { Plus } from "lucide-react";

import { ScopeActionsProvider } from "@/components/quote-editor/scope/actions";
import { SAVED_ITEM_DRAG } from "@/components/quote-editor/library/library-panel";
import { useScopeEditor } from "@/components/quote-editor/scope/use-scope-editor";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CUSTOMER_DETAILS,
  describeScope,
  findNode,
  findParent,
  NODE_SPEC,
  type CustomerDetail,
  type QuoteDraft,
  type ScopeNode,
} from "@/lib/quote";
import { EDITOR_KEYS } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export type ScopeUpdate =
  | ScopeNode[]
  | ((scope: ScopeNode[]) => ScopeNode[]);

/** Where a saved item dropped on Scope lands. `index` null: at the end. */
export type DropTarget = { parentKey: string | null; index: number | null };

/** What the drop indicator draws while a saved item is dragged over Scope. */
type DropHint = {
  target: DropTarget;
  /** The row it lands inside or after. Null: the end of the quote. */
  key: string | null;
  mode: "inside" | "after" | "end";
  label: string;
};


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
  onSaveToLibrary,
  onDropSavedItem,
  detail = "top",
  onDetail,
}: {
  draft: QuoteDraft;
  onScope: (update: ScopeUpdate) => void;
  onNarrative: (value: string) => void;
  /** "Save to library" in the row menu. Absent where there's no Library to save to. */
  onSaveToLibrary?: (node: ScopeNode) => void;
  /**
   * How much of the Scope the customer sees — one total, the top-level rows,
   * or every row. Each group can override it from its row menu.
   */
  detail?: CustomerDetail;
  /** Absent where the choice isn't offered — a change order's rows. */
  onDetail?: (detail: CustomerDetail) => void;
  /** A saved item dragged in from the Library. Absent where nothing can be dragged in. */
  onDropSavedItem?: (savedItemId: string, target: DropTarget) => void;
  /** `read` at phone width — rows open a sheet. `edit` at the desk. */
  mode: "read" | "edit";
  /**
   * A change order's Scope: it holds the change, not the job, and its rows
   * are priced as the difference.
   */
  change?: boolean;
}) {
  const [dropHint, setDropHint] = useState<DropHint | null>(null);

  const { actions, onRowKeyDown, overlays } = useScopeEditor({
    nodes: draft.scope,
    onScope,
    mode,
    detail,
    onSaveToLibrary,
  });

  /**
   * Where a saved item would land if dropped here: inside a group or assembly
   * it is over, after a row it is over, otherwise at the end of the quote.
   */
  function hintFor(event: DragEvent<HTMLDivElement>): DropHint {
    const end: DropHint = {
      target: { parentKey: null, index: null },
      key: null,
      mode: "end",
      label: "Drop to add at the end of the quote",
    };

    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-node-key]");
    const key = row?.dataset.nodeKey;
    const node = key ? findNode(draft.scope, key) : null;
    if (!key || !node) return end;

    const name = node.description.trim() || NODE_SPEC[node.type].label.toLowerCase();

    if (NODE_SPEC[node.type].container) {
      return {
        target: { parentKey: key, index: null },
        key,
        mode: "inside",
        label: `Drop to add inside ${name}`,
      };
    }

    const parent = findParent(draft.scope, key);
    const siblings = parent ? parent.children : draft.scope;
    return {
      target: {
        parentKey: parent?.key ?? null,
        index: siblings.findIndex((sibling) => sibling.key === key) + 1,
      },
      key,
      mode: "after",
      label: `Drop to add after ${name}`,
    };
  }

  const dropHandlers = onDropSavedItem && mode === "edit"
    ? {
        onDragOver(event: DragEvent<HTMLDivElement>) {
          if (!event.dataTransfer.types.includes(SAVED_ITEM_DRAG)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          const next = hintFor(event);
          setDropHint((current) =>
            current?.key === next.key && current?.mode === next.mode ? current : next
          );
        },
        onDragLeave(event: DragEvent<HTMLDivElement>) {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDropHint(null);
        },
        onDrop(event: DragEvent<HTMLDivElement>) {
          const id = event.dataTransfer.getData(SAVED_ITEM_DRAG);
          if (!id) return;
          event.preventDefault();
          const hint = hintFor(event);
          setDropHint(null);
          onDropSavedItem(id, hint.target);
        },
      }
    : {};

  return (
    <ScopeActionsProvider value={actions}>
      <div {...dropHandlers} className="relative">
      {/* The row the drop lands on, marked by its key — one rule for whichever
          row it is, without threading drag state through the tree. */}
      {dropHint?.key ? (
        <style>{`[data-node-key="${CSS.escape(dropHint.key)}"]{${
          dropHint.mode === "inside"
            ? "box-shadow:inset 0 0 0 2px var(--primary);background:color-mix(in oklab,var(--primary) 8%,transparent)"
            : "box-shadow:inset 0 -3px 0 var(--primary)"
        }}`}</style>
      ) : null}
      <SectionCard
        id="scope"
        hintText={
          change
            ? "What's different, row by row. Price only the difference."
            : undefined
        }
        bodyClassName="p-0 @lg:p-0 @2xl:p-0"
        hint={draft.scope.length === 0 && !draft.scopeOfWork.trim()}
        className={cn(
          dropHint && "ring-primary/60 ring-2 ring-offset-2 ring-offset-background"
        )}
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {draft.scope.length ? (
              <span className="text-muted-foreground text-[13px] tabular-nums">
                {describeScope(draft.scope)}
              </span>
            ) : null}
            {onDetail ? (
              <label
                data-tour="quote.customer-detail"
                className="flex items-center gap-2 text-[13px]"
              >
                <span className="text-muted-foreground">Your customer sees</span>
                <Select
                  value={detail}
                  onValueChange={(value) => onDetail(value as CustomerDetail)}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 gap-1 text-[13px]"
                    aria-label="Your customer sees"
                  >
                    {/* The label only — the line under each choice is for
                        the open list. */}
                    <SelectValue>
                      {CUSTOMER_DETAILS.find((option) => option.value === detail)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end" className="max-w-xs">
                    {CUSTOMER_DETAILS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="items-start py-2"
                      >
                        <span className="flex flex-col gap-0.5">
                          <span className="font-medium">{option.label}</span>
                          <span className="text-muted-foreground text-xs leading-snug whitespace-normal">
                            {option.blurb}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            ) : null}
          </div>
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
          {dropHint ? (
            <span className="text-primary-ink ml-auto text-xs font-medium">
              {dropHint.label}
            </span>
          ) : null}
        </div>
      </SectionCard>
      </div>

      {overlays}
    </ScopeActionsProvider>
  );
}
