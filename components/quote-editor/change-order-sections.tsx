"use client";

import { Check } from "lucide-react";

import {
  EditorCard,
  FIELD_LABEL,
  SECTION_PAD,
} from "@/components/quote-editor/section-heading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  flatten,
  formatChange,
  formatMoney,
  makeNode,
  type QuoteDraft,
  type QuoteTotals,
  type ScopeNode,
} from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * The sections a change order has that a quote doesn't.
 *
 * **A change order is the same editor pointed at a different question.** A
 * quote asks "what is the work?"; a change order asks "what is different from
 * what we signed?" So the signed contract sits in the document, line by line,
 * above the Scope that holds the change — and the money column shows the
 * contract, the change and the total after it, rather than a subtotal, a
 * deposit and a schedule that were settled when the contract was signed.
 */

/** A priced line on the signed contract that a change can act on. */
export type ChangeTarget = {
  id: string;
  description: string;
  amountCents: number;
  section: "material" | "labor" | "equipment" | "permit" | null;
  taxable: boolean;
  allowance: boolean;
};

/**
 * What was signed, line by line — the thing this change is measured against.
 *
 * Taking a line out, or settling an allowance, adds a row to Scope that points
 * back at the line it changes; the contract itself is never touched. Swapping
 * work is two moves: remove the old line here, add what replaces it below.
 */
export function SignedContractSection({
  targets,
  draft,
  onScope,
  contractNumber,
  agreedPriceCents,
}: {
  targets: ChangeTarget[];
  draft: QuoteDraft;
  onScope: (scope: ScopeNode[]) => void;
  contractNumber?: string | null;
  agreedPriceCents: number;
}) {
  // Which lines this change already acts on, and how.
  const acting = new Map(
    flatten(draft.scope)
      .filter(({ node }) => node.referencesNodeId)
      .map(({ node }) => [node.referencesNodeId!, node.referenceKind])
  );

  function act(target: ChangeTarget, kind: "deletes" | "settles") {
    onScope([
      ...draft.scope,
      makeNode("item", {
        description: `${kind === "deletes" ? "Remove" : "Settle allowance"}: ${target.description}`,
        section: target.section ?? "material",
        quantity: 1,
        sellPriceCents: kind === "deletes" ? -target.amountCents : 0,
        unitCostCents: null,
        taxable: target.taxable,
        referencesNodeId: target.id,
        referenceKind: kind,
      }),
    ]);
  }

  return (
    <EditorCard
      label={
        contractNumber
          ? `The signed contract · ${contractNumber}`
          : "The signed contract"
      }
      hint="What you both agreed. Take a line out or settle an allowance here — new work goes in Scope below."
      aside={
        <span className="text-muted-foreground tabular-nums">
          {formatMoney(agreedPriceCents)}
        </span>
      }
      bodyClassName="p-0 @lg:p-0 @2xl:p-0"
    >
      {targets.length === 0 ? (
        <p
          className={cn(
            SECTION_PAD,
            "text-muted-foreground py-4 text-sm leading-relaxed"
          )}
        >
          No priced lines on the contract to change. Add what&apos;s new in
          Scope below.
        </p>
      ) : (
        <ul>
          {targets.map((target) => {
            const kind = acting.get(target.id);
            return (
              <li
                key={target.id}
                className={cn(
                  SECTION_PAD,
                  "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t py-3 first:border-t-0"
                )}
              >
                <div className="min-w-0 flex-1 basis-48">
                  <p
                    className={cn(
                      "text-sm",
                      kind === "deletes" && "text-muted-foreground line-through"
                    )}
                  >
                    {target.description || "Untitled line"}
                  </p>
                  {target.allowance ? (
                    <p className="text-muted-foreground text-xs">Allowance</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm tabular-nums">
                  {formatMoney(target.amountCents)}
                </span>
                <div className="flex shrink-0 justify-end gap-1.5 @md:w-44">
                  {kind ? (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <Check className="size-3" />
                      {kind === "deletes" ? "Removed below" : "Settled below"}
                    </span>
                  ) : (
                    <>
                      {target.allowance ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => act(target, "settles")}
                        >
                          Settle
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => act(target, "deletes")}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </EditorCard>
  );
}

/**
 * The money, for a change: the contract as it stands, this change, and the
 * total after it. **Only the difference is priced** — a change order that
 * restated the whole job would make the customer re-agree to work they
 * already signed for.
 */
export function ChangeMoneySection({
  draft,
  sums,
  agreedPriceCents,
  onTaxRate,
}: {
  draft: QuoteDraft;
  sums: QuoteTotals;
  agreedPriceCents: number;
  onTaxRate: (rate: number | null) => void;
}) {
  return (
    <EditorCard
      label="The change"
      hint="Adds itself up from Scope. You never type a total."
    >
      <div className="grid gap-2 text-sm">
        <Line label="Contract now" value={formatMoney(agreedPriceCents)} />
        {sums.taxCents > 0 ? (
          <>
            <Line
              label="Change before tax"
              value={formatChange(sums.subtotalCents)}
            />
            <Line label="Tax" value={formatChange(sums.taxCents)} />
          </>
        ) : null}
        <Line
          label="This change"
          value={formatChange(sums.totalCents)}
          strong
        />
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3 border-t pt-3">
        <span className="font-label text-[11px] uppercase">
          After this change
        </span>
        <span className="text-2xl font-semibold tabular-nums">
          {formatMoney(agreedPriceCents + sums.totalCents)}
        </span>
      </div>

      <label className="mt-4 grid gap-1.5">
        <span className={FIELD_LABEL}>Tax rate on the change</span>
        <div className="relative">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="0.01"
            className="pr-8 tabular-nums"
            value={draft.taxRate === null ? "" : round(draft.taxRate * 100)}
            onChange={(event) =>
              onTaxRate(
                event.target.value === ""
                  ? null
                  : Number(event.target.value) / 100
              )
            }
          />
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">
            %
          </span>
        </div>
      </label>
    </EditorCard>
  );
}

/** The terms don't change with the work — said once, so nobody goes looking. */
export function ChangeTermsSection() {
  return (
    <EditorCard label="Terms">
      <p className="text-muted-foreground text-sm leading-relaxed">
        The signed contract&apos;s terms still apply. This changes the work,
        the price and the schedule — nothing else.
      </p>
    </EditorCard>
  );
}

function Line({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3",
        strong ? "font-medium" : "text-muted-foreground"
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** 8.25, not 8.250000000000002. */
function round(value: number) {
  return Math.round(value * 10000) / 10000;
}
