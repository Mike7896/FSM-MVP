"use client";

import styles from "./scope.module.css";

import { FolderOpen, Layers } from "lucide-react";
import type { ReactNode } from "react";

import { Tag } from "@/components/fields";
import { useScopeActions } from "@/components/quote-editor/scope/actions";
import {
  NODE_SPEC,
  baseTotal,
  formatMoney,
  isEstimated,
  nodeTotal,
  overridesQuote,
  showsBreakdown,
  type ScopeNode,
} from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * The invariant row.
 *
 * Every node in the tree is drawn by this, whatever its type. The bodies supply
 * the `lead` — the description cell, which is the only part that varies — and
 * optionally a `detail` line beneath it. Everything else is decided here, once.
 *
 * **Three weights, from the same row.** A uniform rhythm was the bug: every row
 * the same height, the same spacing and the same colour meant a group, its
 * assembly and a bare exclusion all read as one undifferentiated wall, and the
 * only way to tell them apart was to read them. Proximity and weight do that
 * work instead —
 *
 * - a **container** is a heading: tinted, heavier, with its subtotal on the
 *   right and a rule under it, so the rows below visibly belong to it;
 * - a **priced leaf** is a row: quiet, tight, separated from its siblings by a
 *   hairline;
 * - **unpriced text** is prose: no amount column at all, lighter, indented off
 *   the money — it is a promise rather than a charge and should not look like
 *   one.
 *
 * Indentation is **not** here: the tree owns it, on the list, so a row never
 * has to know how deep it is and the amount column cannot drift with depth.
 *
 * The amount column is the one thing that never moves. Every visible number
 * lines up in the same place at every depth, because a column of totals that
 * jogs with indentation is a column a contractor cannot scan.
 */
export function NodeRow({
  node,
  lead,
  detail,
  trailing,
  onActivate,
}: {
  node: ScopeNode;
  lead: ReactNode;
  detail?: ReactNode;
  /** Actions that belong to this row — the desk's per-node verbs. */
  trailing?: ReactNode;
  /** Read mode: what tapping the row does. */
  onActivate?: () => void;
}) {
  const { mode, customerDetail, priceAnchorKey, priceAnchorOpen } =
    useScopeActions();
  const spec = NODE_SPEC[node.type];

  const estimated = isEstimated(node.source);
  const carriesMoney = spec.priced || spec.container;
  const amount = node.optional ? nodeTotal(node) : baseTotal(node);

  const row = (
    <div
      data-node-key={node.key}
      data-kind={spec.container ? "container" : spec.priced ? "priced" : "text"}
      data-optional={node.optional || undefined}
      data-mode={mode}
      className={cn(
        "group/row",
        styles.row,
        mode === "read" && onActivate && "hover:bg-muted/60 transition-colors",
        // Unpriced text sits off the money column entirely.
        !carriesMoney && "text-muted-foreground"
      )}
    >
      {/* The first line: the words, the verbs, the amount. */}
      <div className={styles.rowTop}>
        <div className={styles.lead}>
          {spec.container ? <span className={styles.groupIcon} aria-hidden="true">{node.type === "assembly" ? <Layers size={16} /> : <FolderOpen size={16} />}</span> : null}
          {lead}
          {spec.badge || spec.container ? (
            <Tag>
              {spec.badge || "GROUP"}
              {/* An assembly admits to its child count without opening: one row
                  to the customer, five cost rows to the estimator, and the
                  divergence is the whole reason the tree exists. */}
              {spec.container && node.children.length
                ? ` · ${node.children.length}`
                : ""}
            </Tag>
          ) : null}
          {node.optional ? <Tag>OPTIONAL</Tag> : null}
          {/* Only where this group differs from the quote's setting — the
              exception is what needs pointing out. */}
          {overridesQuote(node, customerDetail) ? (
            <Tag
              title={
                showsBreakdown(node, customerDetail)
                  ? "Your customer sees the rows inside this, with their prices."
                  : "Your customer sees this as one line with its total."
              }
            >
              {showsBreakdown(node, customerDetail) ? "ROWS SHOWN" : "ONE LINE"}
            </Tag>
          ) : null}
        </div>

        {trailing}

        {/* The column, held at one width on every row that carries money, so the
            amounts stack into one scannable column at every depth. Unpriced
            text does not reserve it: a note has no number to line up, and the
            empty 96px squeezed one-line exclusions onto two lines. */}
        {carriesMoney ? (
          <span className={styles.amount}>
            {estimated ? (
              <Tag
                title="Our starting number, not yours. Change it and this goes away."
                // Louder than the other tags on purpose: it is the only one
                // asking for something, and it has to read at a glance.
                className="border-foreground/40 text-foreground border-dashed"
              >
                EST
              </Tag>
            ) : null}
            <span
              className={cn(
                "text-right text-sm tabular-nums",
                spec.container ? "font-semibold" : "font-medium",
                amount === 0 && "text-muted-foreground font-normal",
                // A credit — a line a change order takes out.
                amount < 0 && "text-negative",
                node.optional && "text-muted-foreground font-normal",
                estimated &&
                  "decoration-muted-foreground/60 underline decoration-dashed underline-offset-4"
              )}
            >
              {node.optional ? `+${formatMoney(amount)}` : formatMoney(amount)}
            </span>
          </span>
        ) : null}
      </div>

      {/* The detail runs the full width of the row, under the amount as well.
          The amount column only has something in it on the first line, and
          holding it empty on the second is what wrapped quantity, unit and
          price onto three lines at laptop width. */}
      {detail ? (
        <div className={styles.detail}>
          {detail}
        </div>
      ) : null}
    </div>
  );

  if (mode === "read" && onActivate) {
    return (
      <button
        type="button"
        onClick={onActivate}
        {...(node.key === priceAnchorKey && !priceAnchorOpen
          ? { "data-tour": "quote.row-price" }
          : {})}
        className={cn("w-full text-left", styles.readButton)}
      >
        {row}
      </button>
    );
  }

  return (
    <div>
      {row}
    </div>
  );
}
