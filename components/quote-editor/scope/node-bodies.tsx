"use client";

import styles from "./scope.module.css";

import { useState, type ComponentType } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";

import {
  EditableParagraph,
  EditableText,
  MoneyInput,
  NumberInput,
  Tag,
  UnitInput,
} from "@/components/fields";
import { useScopeActions } from "@/components/quote-editor/scope/actions";
import { NodeRow } from "@/components/quote-editor/scope/node-row";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  COST_BUCKETS,
  NODE_SPEC,
  bucket,
  formatMoney,
  formatQuantity,
  markupFromSell,
  moneyInputValue,
  parseMoney,
  parseQuantity,
  sellFromCost,
  type LineSection,
  type NodeType,
  type ScopeNode,
} from "@/lib/quote";
import { emitTourEvent } from "@/lib/tours";
import { cn } from "@/lib/utils";

/**
 * **Seven types, three bodies.**
 *
 * The thing worth noticing about the seven node types is how little they
 * actually differ. Strip away the badge and the words and there are three
 * shapes: something with a quantity and a price, something with children and a
 * subtotal, and a sentence. `item` and `allowance` share the first; `group` and
 * `assembly` share the second; `note`, `exclusion` and `assumption` share the
 * third.
 *
 * That collapse is what stops a composable structure reading as seven features.
 * The registry carries what genuinely varies — the badge, the label, the words
 * on the door — and the shape is one of three. A new type picks a body; it does
 * not bring one.
 */

export type BodyKind = "priced" | "container" | "text";

/**
 * A row's own text field — a notch shorter than the Header's, so a tree of
 * them reads as rows of a list rather than a stack of form fields.
 */
const ROW_FIELD = styles.description;

export function bodyKind(type: NodeType): BodyKind {
  const spec = NODE_SPEC[type];
  if (spec.container) return "container";
  return spec.priced ? "priced" : "text";
}

/**
 * A body takes the node and nothing else. **Depth is deliberately absent**: the
 * tree owns indentation, on the list, so no row has to know how deep it sits
 * and the amount column cannot drift with nesting.
 */
export type BodyProps = { node: ScopeNode };

/* ── Priced leaf — item, allowance ────────────────────────────────────── */

function PricedBody({ node }: BodyProps) {
  const { mode, patch, open, priceAnchorKey } = useScopeActions();

  // Money is held as text while focused so a half-typed "12." is not
  // round-tripped through the parser into "$12.00" under the cursor.
  const [sellText, setSellText] = useState<string | null>(null);
  const [qtyText, setQtyText] = useState<string | null>(null);
  const [costOpen, setCostOpen] = useState(false);

  /** Any edit to the numbers is the contractor taking ownership of the row. */
  function own(fields: Partial<ScopeNode>) {
    patch(node.key, { ...fields, source: "typed" });
  }

  const perUnit = node.quantity !== 1 && node.unit;

  if (mode === "read") {
    return (
      <NodeRow
        node={node}
        onActivate={() => open(node.key)}
        lead={
          <span className="min-w-0 truncate text-sm">
            {node.description || "Untitled row"}
            {perUnit ? (
              <span className="text-muted-foreground">
                {` — ${formatQuantity(node.quantity)} ${node.unit}`}
              </span>
            ) : null}
          </span>
        }
        detail={
          // An allowance says what it is on the row rather than in a legend.
          // "Provisional" is the word that stops it reading as a firm price.
          node.type === "allowance" ? (
            // Not "once she picks": an allowance is as often a repair's parts
            // as a finish the customer chooses, and the customer is not
            // assumed to be anyone in particular.
            <>Provisional — trued up against what&apos;s actually used.</>
          ) : null
        }
      />
    );
  }

  return (
    <>
      <NodeRow
        node={node}
        trailing={<NodeMenu node={node} />}
        lead={
          <EditableText
            value={node.description}
            placeholder="What is it?"
            aria-label="Description"
            className={cn(ROW_FIELD, "min-w-0 flex-1")}
            onChange={(event) =>
              patch(node.key, { description: event.target.value })
            }
          />
        }
        detail={
          <div className={styles.pricingControls}>
            <label className={styles.control}><span>Qty</span>
              <NumberInput
                size="sm"
                aria-label="Quantity"
                value={qtyText ?? formatQuantity(node.quantity)}
                onChange={(event) => {
                  setQtyText(event.target.value);
                  const parsed = parseQuantity(event.target.value);
                  if (parsed !== null) own({ quantity: parsed });
                }}
                onBlur={() => setQtyText(null)}
              />
            </label>
            <label className={styles.control}><span>Unit</span>
              <UnitInput
                size="sm"
                aria-label="Unit"
                value={node.unit ?? ""}
                placeholder="unit"
                onChange={(event) =>
                  patch(node.key, { unit: event.target.value || null })
                }
              />
            </label>
            <label className={styles.control}><span>Unit price</span>
              <MoneyInput
                size="sm"
                aria-label="Price per unit"
                {...(node.key === priceAnchorKey
                  ? { "data-tour": "quote.row-price" }
                  : {})}
                value={sellText ?? moneyInputValue(node.sellPriceCents)}
                onChange={(event) => {
                  setSellText(event.target.value);
                  const cents = parseMoney(event.target.value);
                  if (cents === null) return;
                  if (cents > 0) emitTourEvent("quote.price-entered");
                  own({
                    sellPriceCents: cents,
                    // Keep markup honest rather than stale: if he sets the price
                    // by hand, the markup is whatever that price implies over
                    // cost.
                    markupPercent:
                      node.unitCostCents === null
                        ? node.markupPercent
                        : markupFromSell(node.unitCostCents, cents),
                  });
                }}
                onBlur={() => setSellText(null)}
              />

            </label>

            {/* Cost controls remain visible, separated from the customer price. */}
            <span className={styles.costControls}>
            <BucketPicker node={node} />

            <button
              type="button"
              aria-expanded={costOpen}
              onClick={() => setCostOpen((value) => !value)}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/60 -mx-1 flex items-center gap-1 rounded px-1 py-0.5 transition-colors"
            >
              <ChevronDown
                className={cn(
                  "size-3 transition-transform",
                  costOpen && "rotate-180"
                )}
              />
              {node.unitCostCents === null
                ? "Add your cost"
                : `Costs you ${formatMoney(node.unitCostCents)}`}
            </button>
            </span>
          </div>
        }
      />

      {costOpen ? <CostFields node={node} /> : null}
    </>
  );
}

/**
 * Cost and markup — folded away because they are the shop's business, and
 * looking at them is a separate act from pricing the job.
 */
function CostFields({ node }: { node: ScopeNode }) {
  const { patch } = useScopeActions();
  const [costText, setCostText] = useState<string | null>(null);

  return (
    // Inset by the section's padding, so its edges line up with the row
    // text above it rather than floating 8px to one side.
    <div className={styles.costFields}>
      <div className="grid gap-1.5">
        <Label className="text-muted-foreground text-xs">
          Your cost per {node.unit ?? "unit"}
        </Label>
        <div className="relative">
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm">
            $
          </span>
          <Input
            inputMode="decimal"
            className="h-8 pl-6 text-right tabular-nums"
            placeholder="0.00"
            value={costText ?? moneyInputValue(node.unitCostCents)}
            onChange={(event) => {
              setCostText(event.target.value);
              const cents = parseMoney(event.target.value);
              patch(node.key, {
                unitCostCents: cents,
                // Cost moves, markup holds, price follows. That is the
                // direction a price book works in — the shop decides what it
                // makes, not what a supplier charged this week.
                sellPriceCents:
                  cents !== null && node.markupPercent !== null
                    ? sellFromCost(cents, node.markupPercent)
                    : node.sellPriceCents,
              });
            }}
            onBlur={() => setCostText(null)}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label className="text-muted-foreground text-xs">Markup</Label>
        <div className="relative">
          <Input
            inputMode="decimal"
            className="h-8 pr-7 text-right tabular-nums"
            placeholder="0"
            value={node.markupPercent ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              const percent = value === "" ? null : Number(value);
              if (percent !== null && !Number.isFinite(percent)) return;
              patch(node.key, {
                markupPercent: percent,
                sellPriceCents:
                  node.unitCostCents !== null && percent !== null
                    ? sellFromCost(node.unitCostCents, percent)
                    : node.sellPriceCents,
              });
            }}
          />
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm">
            %
          </span>
        </div>
      </div>

      <div className="flex items-end pb-1">
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Switch
            checked={node.taxable}
            onCheckedChange={(checked) =>
              patch(node.key, { taxable: checked })
            }
          />
          Taxable
        </Label>
      </div>
    </div>
  );
}

function BucketPicker({ node }: { node: ScopeNode }) {
  const { patch } = useScopeActions();
  const current = bucket(node.section);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Cost bucket">
          <Tag interactive className="cursor-pointer">
            {current.tag}
          </Tag>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Cost category</DropdownMenuLabel>
        {COST_BUCKETS.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={() =>
              patch(node.key, {
                section: option.id as LineSection,
                // The bucket decides the default, and changing bucket on a row
                // whose tax setting is still the old bucket's default should
                // follow it. A row he has deliberately toggled keeps his answer
                // — but there is no flag for "he toggled it", so the honest
                // version is to leave taxable alone and let him see the switch.
                unit: node.unit ?? option.defaultUnit,
              })
            }
          >
            <span className="grid min-w-0 gap-1">
              <span className="font-medium">{option.label}</span>
              <span className="text-muted-foreground text-xs leading-relaxed">{option.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Container — group, assembly ──────────────────────────────────────── */

function ContainerBody({ node }: BodyProps) {
  const { mode, patch, open } = useScopeActions();

  const lead =
    mode === "read" ? (
      <span className="min-w-0 truncate text-sm font-medium">
        {node.description || (node.type === "group" ? "Untitled group" : "Assembly")}
      </span>
    ) : (
      <EditableText
        value={node.description}
        placeholder={
          node.type === "group"
            ? "What's this part of the job?"
            : "What's the bundle?"
        }
        aria-label="Name"
        className={cn(ROW_FIELD, "min-w-0 flex-1 font-semibold")}
        onChange={(event) =>
          patch(node.key, { description: event.target.value })
        }
      />
    );

  return (
    <>
      <NodeRow
        node={node}
        onActivate={mode === "read" ? () => open(node.key) : undefined}
        trailing={mode === "edit" ? <NodeMenu node={node} /> : undefined}
        lead={lead}
        detail={
          node.type === "assembly" && node.children.length ? (
            // 54b's sentence, said on screen rather than left implied. A
            // contractor who does not trust what she sees will flatten his own
            // estimate by hand, which is the one outcome the assembly exists to
            // prevent.
            <>
              One row on her quote. The {node.children.length} rows underneath
              are how you priced it.
            </>
          ) : null
        }
      />

    </>
  );
}

/* ── Unpriced text — note, exclusion, assumption ──────────────────────── */

function TextBody({ node }: BodyProps) {
  const { mode, patch, open } = useScopeActions();

  if (mode === "read") {
    return (
      <NodeRow
        node={node}
        onActivate={() => open(node.key)}
        lead={
          <span className="text-muted-foreground min-w-0 flex-1 text-sm leading-relaxed">
            {node.description || NODE_SPEC[node.type].label}
          </span>
        }
      />
    );
  }

  return (
    <NodeRow
      node={node}
      trailing={<NodeMenu node={node} />}
      lead={
        <EditableParagraph
          rows={1}
          tone="muted"
          value={node.description}
          aria-label={NODE_SPEC[node.type].label}
          placeholder={PLACEHOLDER[node.type as TextType]}
          // One line at rest and growing with the words — the paragraph
          // field's 80px floor made every one-line exclusion a tall empty box.
          className={cn(ROW_FIELD, "min-w-0 flex-1")}
          onChange={(event) =>
            patch(node.key, { description: event.target.value })
          }
        />
      }
    />
  );
}

type TextType = "note" | "exclusion" | "assumption";

/**
 * The trade's words, not the model's. An electrician does not write an
 * assumption node — he writes down what he is taking as given.
 */
const PLACEHOLDER: Record<TextType, string> = {
  note: "Anything she should read but not pay for.",
  exclusion: "Something this price doesn't cover.",
  assumption: "Something you're taking as given.",
};

/* ── The per-row menu ─────────────────────────────────────────────────── */

/**
 * What can be done to one row.
 *
 * **Optional is here rather than in the picker**, because it is a flag on a row
 * he has already added, not a kind of row. Retyping is here too: the picker's
 * six doors cover writing, and this is the correction — a note that turns out
 * to be an exclusion keeps its words and its place in the tree.
 */
function NodeMenu({ node }: { node: ScopeNode }) {
  const { patch, remove, move, dissolve, group, retype } = useScopeActions();
  const spec = NODE_SPEC[node.type];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          // Discoverable at rest; full emphasis on hover and keyboard focus.
          className={cn(
            "text-muted-foreground size-8 shrink-0 transition-opacity", styles.menu,
            "group-hover/row:opacity-100 group-focus-within/row:opacity-100",
            "focus-visible:opacity-100 data-[state=open]:opacity-100"
          )}
          aria-label={`Options for ${node.description || spec.label}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Row actions</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => move(node.key, -1)}>
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => move(node.key, 1)}>
          Move down
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Offered on containers as well as leaves. **An optional group is
            meaningful** — "the second bathroom, if you want it" is one
            decision over several rows — and the tree already pushes the flag
            down to everything inside. Unpriced text is the only thing this
            cannot apply to: there is no price for her to opt into. */}
        {spec.priced || spec.container ? (
          <DropdownMenuItem
            onSelect={() => patch(node.key, { optional: !node.optional })}
          >
            {node.optional
              ? "Include in base price"
              : "Make optional"}
          </DropdownMenuItem>
        ) : null}

        {!spec.container ? (
          <DropdownMenuItem onSelect={() => group(node.key)}>
            Move into a new group
          </DropdownMenuItem>
        ) : null}

        {spec.container && node.children.length ? (
          <DropdownMenuItem onSelect={() => dissolve(node.key)}>
            Break apart — keep the rows
          </DropdownMenuItem>
        ) : null}

        {/* Retyping only within a body kind. Turning a note into a priced row
            would ask what it costs at the moment he is writing a sentence, and
            turning a group into a line would orphan everything inside it. */}
        {RETYPE_WITHIN[bodyKind(node.type)]
          .filter((type) => type !== node.type)
          .map((type) => (
            <DropdownMenuItem
              key={type}
              onSelect={() => retype(node.key, type)}
            >
              Make it {NODE_SPEC[type].label.toLowerCase()}
            </DropdownMenuItem>
          ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          onSelect={() => remove(node.key)}
        >
          <span className="grid min-w-0 gap-1">
            <span>Delete {spec.container ? "group" : "row"}</span>
            {spec.container && node.children.length > 0 ? (
              <span className="text-xs leading-relaxed">Also deletes the {node.children.length} rows inside.</span>
            ) : null}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Which types a row can become without changing shape. */
const RETYPE_WITHIN: Record<BodyKind, NodeType[]> = {
  priced: ["item", "allowance"],
  container: ["group", "assembly"],
  text: ["note", "exclusion", "assumption"],
};

/* ── The registry the tree dispatches through ─────────────────────────── */

export const NODE_BODIES: Record<BodyKind, ComponentType<BodyProps>> = {
  priced: PricedBody,
  container: ContainerBody,
  text: TextBody,
};
