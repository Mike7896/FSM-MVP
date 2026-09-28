"use client";

import { Lock } from "lucide-react";

import {
  COST_BUCKETS,
  formatMoney,
  margin,
  shapeOf,
  type QuoteDraft,
} from "@/lib/quote";

/**
 * Your margin — **the desk's other reason to exist**, alongside the capture
 * panel.
 *
 * **It lives here and nowhere else.** Alone at the desk is the only safe place
 * for cost and markup: it never reaches anything the homeowner can open, and it
 * is not on the phone, where the screen is read in a driveway with the customer
 * a metre away. The panel says so out loud, because a contractor who is not
 * certain this stays private will not put his real costs in — and a price book
 * with no real costs in it never becomes worth anything.
 *
 * **This is where cost buckets surface, and one of only two places they do.**
 * Material, labor, equipment and permit are not how the document is organised —
 * they are what the price book learns from and what this panel sums. Per bucket
 * rather than in total, because that is where the mistake actually hides:
 * labor, almost always.
 *
 * **Optional rows are out of both sides.** A row the customer has not added yet
 * cannot be counted in the margin he is judging — that would make every quote
 * look better than it is.
 *
 * When some rows carry no cost the answer is "we can't tell you yet" rather
 * than a number computed off the rows that happen to have one. A margin that
 * silently describes 40% of the quote is worse than no margin, because he will
 * bid against it.
 */
export function MarginCheck({ draft }: { draft: QuoteDraft }) {
  const result = margin(draft);
  const priced = shapeOf(draft.scope).priced > 0;

  return (
    <div
      data-tour="quote.margin"
      className="bg-background rounded-xl border border-dashed p-4"
    >
      {/* Dashed, unnumbered and marked private, because this is the one panel
          in the rail that is not part of the document. The numbered cards
          below it are what the customer reads; this never leaves the desk. */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-foreground/80 font-label text-xs leading-5 uppercase">
          Your margin
        </p>
        <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
          <Lock className="size-3" />
          Only you
        </span>
      </div>

      {!priced || result.revenueCents === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Click “Add your cost” on a row and your margin shows up here.
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">
              {result.marginPercent}%
            </span>
            <span className="text-muted-foreground tabular-nums">
              {formatMoney(result.marginCents)}
            </span>
          </div>

          {!result.complete ? (
            /* Stated rather than hidden. He needs to know the number is
               describing part of the quote before he trusts it. */
            <p className="text-muted-foreground mt-1.5 text-xs">
              From the rows with a cost on them.
            </p>
          ) : null}

          <dl className="mt-3 border-t pt-2 text-[13px]">
            {COST_BUCKETS.map((cost) => {
              const line = result.byBucket[cost.id];
              if (line.priceCents === 0) return null;
              const bucketMargin =
                line.costCents > 0
                  ? Math.round(
                      ((line.priceCents - line.costCents) / line.priceCents) * 100
                    )
                  : null;

              return (
                <div
                  key={cost.id}
                  className="text-muted-foreground flex justify-between gap-2 py-1"
                >
                  <dt className="truncate">{cost.label}</dt>
                  <dd className="tabular-nums">
                    {formatMoney(line.priceCents)}
                    {/* Fixed width and right-aligned, so the amounts before it
                        stack into a column whether this says "61%" or "no
                        cost set". */}
                    <span className="ml-2 inline-block w-[4.5rem] text-right text-xs">
                      {bucketMargin === null
                        ? // A pass-through row is not a margin of zero, and a
                          // permit fee priced at cost is the common case.
                          "no cost set"
                        : `${bucketMargin}%`}
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>

          <div className="mt-1.5 flex justify-between border-t pt-2.5 text-[13px] font-medium">
            <span>Costs you</span>
            <span className="tabular-nums">{formatMoney(result.costCents)}</span>
          </div>
        </>
      )}

    </div>
  );
}
