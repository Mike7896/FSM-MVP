"use client";

import styles from "./scope.module.css";

import { useState, type ComponentType } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  Lock,
  MoreHorizontal,
  Trash2,
} from "lucide-react";

import {
  EditableParagraph,
  EditableText,
  MoneyInput,
  Tag,
} from "@/components/fields";
import { useScopeActions } from "@/components/quote-editor/scope/actions";
import { NodeRow } from "@/components/quote-editor/scope/node-row";
import { QuantityStepper } from "@/components/quote-editor/scope/quantity-stepper";
import { UnitPicker } from "@/components/quote-editor/scope/unit-picker";
import { Keys } from "@/components/shortcuts/keys";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  COST_BUCKETS,
  CUSTOMER_DETAILS,
  NODE_SPEC,
  bucket,
  formatMoney,
  formatQuantity,
  markupFromSell,
  moneyInputValue,
  parseMoney,
  sellFromCost,
  type LineSection,
  type NodeType,
  type ScopeNode,
} from "@/lib/quote";
import { ROW_KEYS, type KeyName } from "@/lib/shortcuts";
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
          <span className={cn(styles.readName, "text-sm")}>
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
        trailing={<RowActions node={node} />}
        lead={
          <EditableText
            data-row-field="description"
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
              <QuantityStepper
                value={node.quantity}
                onChange={(quantity) => own({ quantity })}
              />
            </label>
            <div className={styles.control}><span>Unit</span>
              <UnitPicker
                value={node.unit}
                section={node.section}
                onChange={(unit) => patch(node.key, { unit })}
              />
            </div>
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
              <Lock className="size-3" />
              {node.unitCostCents === null
                ? "Your cost & markup"
                : `Costs you ${formatMoney(node.unitCostCents)}${
                    node.markupPercent !== null
                      ? ` · ${Number(node.markupPercent.toFixed(1))}% markup`
                      : ""
                  }`}
              <ChevronDown
                className={cn(
                  "size-3 transition-transform",
                  costOpen && "rotate-180"
                )}
              />
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
 *
 * What it does, said in the panel: cost × markup sets the unit price, the
 * pair feeds "Your margin", and it's kept on this quote's row only — there is
 * no price book to save it to yet.
 */
function CostFields({ node }: { node: ScopeNode }) {
  const { patch } = useScopeActions();
  const [costText, setCostText] = useState<string | null>(null);

  return (
    // Inset by the section's padding, so its edges line up with the row
    // text above it rather than floating 8px to one side.
    <div className={styles.costFields}>
      <p className={cn(styles.costNote, "text-muted-foreground text-xs leading-relaxed")}>
        <strong className="text-foreground font-medium">Only you see this.</strong>{" "}
        Enter what this costs you and your markup, and the unit price is worked
        out for you. It also feeds Your margin. Saved on this quote only — not
        to a price book.
      </p>
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
                // The unit follows the category while it's still the old
                // category's default — a new line is "ea" because it starts as
                // material, and Labor should make that "hr". A unit he picked
                // himself stays. Taxable is left alone: there's no telling a
                // default from a choice there, so he sees the switch instead.
                unit:
                  !node.unit || node.unit === current.defaultUnit
                    ? option.defaultUnit
                    : node.unit,
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
      <span className={cn(styles.readName, "text-sm font-semibold")}>
        {node.description || (node.type === "group" ? "Untitled group" : "Assembly")}
      </span>
    ) : (
      <EditableText
        data-row-field="description"
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
        trailing={mode === "edit" ? <RowActions node={node} /> : undefined}
        lead={lead}
        detail={
          node.type === "assembly" && node.children.length ? (
            // 54b's sentence, said on screen rather than left implied. A
            // contractor who does not trust what she sees will flatten his own
            // estimate by hand, which is the one outcome the assembly exists to
            // prevent.
            node.children.length === 1 ? (
              <>One row on her quote. The row underneath is how you priced it.</>
            ) : (
              <>
                One row on her quote. The {node.children.length} rows underneath
                are how you priced it.
              </>
            )
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
      trailing={<RowActions node={node} />}
      lead={
        <EditableParagraph
          data-row-field="description"
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

/* ── The row's buttons ────────────────────────────────────────────────── */

/**
 * Move up, move down, duplicate and delete as buttons on the row — the things
 * done most often — and everything else behind the menu.
 */
function RowActions({ node }: { node: ScopeNode }) {
  const { move, remove, duplicate, position } = useScopeActions();
  const { first, last } = position(node.key);
  const name = NODE_SPEC[node.type].label.toLowerCase();

  return (
    <div className={cn("flex shrink-0 items-center", styles.rowActions)}>
      {/* The arrows give way first in a narrow column; the menu has them too. */}
      <span className={cn("flex items-center", styles.moveActions)}>
        <IconAction
          label="Move up"
          keys={ROW_KEYS.moveUp}
          disabled={first}
          onClick={() => move(node.key, -1)}
        >
          <ArrowUp />
        </IconAction>
        <IconAction
          label="Move down"
          keys={ROW_KEYS.moveDown}
          disabled={last}
          onClick={() => move(node.key, 1)}
        >
          <ArrowDown />
        </IconAction>
      </span>
      <IconAction
        label={`Duplicate ${name}`}
        keys={ROW_KEYS.duplicate}
        onClick={() => duplicate(node.key)}
      >
        <Copy />
      </IconAction>
      <IconAction
        label={`Delete ${name}`}
        keys={ROW_KEYS.remove}
        destructive
        onClick={() => remove(node.key)}
      >
        <Trash2 />
      </IconAction>
      <NodeMenu node={node} />
    </div>
  );
}

function IconAction({
  label,
  keys,
  disabled,
  destructive,
  onClick,
  children,
}: {
  label: string;
  keys: KeyName[];
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-keyshortcuts={keys.join("+")}
          // Out of the Tab order: Tab from a description goes straight to its
          // quantity, and the keyboard has these as shortcuts.
          tabIndex={-1}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "text-muted-foreground hover:text-foreground size-8 disabled:opacity-30",
            destructive && "hover:text-destructive hover:bg-destructive/10"
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <Keys keys={keys} />
      </TooltipContent>
    </Tooltip>
  );
}

/* ── The per-row menu ─────────────────────────────────────────────────── */

/**
 * Everything that can be done to one row — the buttons beside it are
 * shortcuts to the commonest three.
 */
function NodeMenu({ node }: { node: ScopeNode }) {
  const {
    patch,
    remove,
    move,
    position,
    dissolve,
    group,
    retype,
    duplicate,
    moveTargets,
    moveTo,
    saveToLibrary,
    customerDetail,
  } = useScopeActions();
  const spec = NODE_SPEC[node.type];
  const { first, last } = position(node.key);
  const targets = moveTargets(node.key);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-8 shrink-0"
          aria-label={`More for ${node.description || spec.label}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{spec.label}</DropdownMenuLabel>
        <DropdownMenuItem disabled={first} onSelect={() => move(node.key, -1)}>
          Move up
          <DropdownMenuShortcut>
            <Keys keys={ROW_KEYS.moveUp} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => move(node.key, 1)}>
          Move down
          <DropdownMenuShortcut>
            <Keys keys={ROW_KEYS.moveDown} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        {targets.length ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              {targets.map((target) => (
                <DropdownMenuItem
                  key={target.key ?? "top"}
                  onSelect={() => moveTo(node.key, target.key)}
                  style={{ paddingLeft: `${0.5 + target.depth * 0.75}rem` }}
                >
                  <span className="min-w-0 truncate">{target.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuItem onSelect={() => duplicate(node.key)}>
          Duplicate
          <DropdownMenuShortcut>
            <Keys keys={ROW_KEYS.duplicate} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        {saveToLibrary ? (
          <DropdownMenuItem onSelect={() => saveToLibrary(node.key)}>
            Save to library
          </DropdownMenuItem>
        ) : null}

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

        {/* What the customer sees of this group: its rows, or one line. The
            quote sets it for every group; this sets it for this one. */}
        {spec.container ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Your customer sees</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72">
              {customerDetail === "total" ? (
                <DropdownMenuLabel className="text-muted-foreground text-xs leading-snug font-normal">
                  This quote shows one total, so no rows are shown. This
                  applies if you switch it back.
                </DropdownMenuLabel>
              ) : null}
              <DropdownMenuRadioGroup
                value={node.breakdown ?? "quote"}
                onValueChange={(value) =>
                  patch(node.key, {
                    breakdown: value === "quote" ? null : (value as "show" | "hide"),
                  })
                }
              >
                <DropdownMenuRadioItem value="show">
                  The rows inside, with their prices
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="hide">
                  One line with its total
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="quote">
                  Same as the quote (
                  {CUSTOMER_DETAILS.find((option) => option.value === customerDetail)
                    ?.label.toLowerCase()}
                  )
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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
              Change to {NODE_SPEC[type].label.toLowerCase()}
            </DropdownMenuItem>
          ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          onSelect={() => remove(node.key)}
        >
          <span className="grid min-w-0 gap-1">
            <span>Delete {spec.label.toLowerCase()}</span>
            {spec.container && node.children.length > 0 ? (
              <span className="text-xs leading-relaxed">Also deletes the {node.children.length} rows inside.</span>
            ) : null}
          </span>
          <DropdownMenuShortcut>
            <Keys keys={ROW_KEYS.remove} />
          </DropdownMenuShortcut>
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
