import { formatMoney } from "@/lib/quote";
import { inkFor } from "@/components/documents/ink";
import { cn } from "@/lib/utils";

/**
 * A document, drawn as a document.
 *
 * **The thing on the shelf should look like the thing.** A product whose whole
 * subject is paper — quotes, contracts, change orders, invoices — represents
 * each one as a table row with a name and a chevron, which is what every list
 * in every app looks like and tells a contractor nothing about *which* document
 * he is looking at. Google Docs solved this a long time ago by showing the
 * first page, and the reason it works is not aesthetic: you recognise your own
 * document by its shape and its first few lines, far faster than by reading a
 * filename.
 *
 * So this is a miniature, and everything in it is **real** — the shop's own
 * name, the customer's, the contractor's own words on his own scope rows, the
 * total the same arithmetic produced everywhere else. Grey placeholder bars
 * would have been much easier and would have defeated the entire point: two
 * quotes must not look alike.
 *
 * **It is a preview, not the projection.** `QuoteProjection` is what the
 * customer opens and it renders at reading size with a primary action on it;
 * this renders at a glance size with none. They read from the same data and
 * neither derives from the other — which is deliberate, because a thumbnail
 * that reused the customer's page would inherit a button nobody can press and
 * a terms sentence nobody can read at 9px.
 *
 * The page **fades out at the bottom** rather than stopping. A document that
 * ends cleanly at the edge of a card reads as a short document; one that fades
 * reads as a page with more of it below, which is what it is.
 */

export type ThumbnailRow = {
  description: string;
  amountCents: number;
  /** Unpriced text — an exclusion or an assumption. Drawn without a number. */
  unpriced: boolean;
};

export function DocumentThumbnail({
  businessName,
  license,
  customerName,
  title,
  rows,
  totalCents,
  /** The word at the top of the page. A legal fact, not a label. */
  documentType = "Quote",
  number,
  className,
}: {
  businessName: string | null;
  license: string | null;
  customerName: string | null;
  title: string | null;
  rows: ThumbnailRow[];
  totalCents: number;
  documentType?: string;
  number?: string | null;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        // **The top of a page, not a whole page.** Full paper proportions left
        // a third of every card blank, because a four-line quote genuinely is a
        // short document — and an empty page reads as a broken thumbnail rather
        // than an honest one. Cropping to the top and fading out says the same
        // true thing without the dead space.
        //
        // Paper keeps its own colour in both themes: a document is a light
        // object even in a dark interface, the way it is on a desk at night.
        // Square: the tile it sits in is a sheet of paper, and paper has
        // corners.
        "@container relative aspect-[3/4] w-full overflow-hidden bg-white text-[#111] select-none",
        className
      )}
    >
      {/* The paper's colour, top edge to edge. */}
      <div className={cn("absolute inset-x-0 top-0 h-[3px]", inkFor(documentType).band)} />

      <div className="flex min-w-0 flex-col px-[10%] pt-[12%] pb-[10%] text-[clamp(6px,3.6cqw,9px)] leading-[1.5]">
        {/* The trust header — the ten seconds in which she decides whether this
            is a real licensed business. It is the first thing on her page, so
            it is the first thing here. */}
        <div className="flex min-w-0 flex-col gap-[0.35em] border-b border-[#dedede] pb-[1em]">
          <span className="line-clamp-2 text-[1.25em] font-semibold tracking-tight [overflow-wrap:anywhere]">
            {businessName || " "}
          </span>
          {license ? (
            <span className="truncate text-[0.85em] tracking-wide text-[#777]">
              LIC #{license}
            </span>
          ) : null}
        </div>

        <div className="mt-[1em] flex min-w-0 flex-wrap items-baseline justify-between gap-x-[1em] gap-y-[0.3em]">
          <span className="min-w-0 truncate text-[#666]">
            {customerName ? `Prepared for ${customerName}` : " "}
          </span>
          {number ? (
            <span className="shrink-0 text-[0.85em] tabular-nums text-[#888]">
              {number}
            </span>
          ) : null}
        </div>

        {/* What this paper is, in its own ink. */}
        <p className={cn("mt-[1.8em] text-[0.85em] font-semibold tracking-[0.14em] uppercase", inkFor(documentType).word)}>
          {documentType}
        </p>

        <p className="mt-[0.4em] line-clamp-2 text-[1.2em] font-semibold leading-[1.35] [overflow-wrap:anywhere]">
          {title || "Untitled"}
        </p>

        {/* The rows. Real descriptions and real money — this is what makes one
            document distinguishable from another at this size. */}
        <div className="mt-[1.5em] flex flex-col">
          {rows.length === 0 ? (
            <span className="border-t border-[#efefef] pt-[0.75em] text-[#999]">Nothing priced yet</span>
          ) : (
            rows.map((row, index) => (
              <div
                key={index}
                className="flex min-w-0 items-baseline justify-between gap-[1em] border-t border-[#efefef] py-[0.65em]"
              >
                <span
                  className={cn(
                    "min-w-0 line-clamp-2 [overflow-wrap:anywhere]",
                    row.unpriced && "text-[#888] italic"
                  )}
                >
                  {row.description || " "}
                </span>
                {!row.unpriced ? (
                  <span className="shrink-0 tabular-nums">
                    {formatMoney(row.amountCents)}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </div>

        {totalCents > 0 ? (
          <div className="mt-[0.8em] flex items-baseline justify-between gap-[1em] border-t border-[#bfc3c7] pt-[0.85em]">
            <span className="text-[0.85em] tracking-[0.08em] text-[#666] uppercase">
              Total
            </span>
            <span className="text-[1.45em] font-semibold tabular-nums">
              {formatMoney(totalCents)}
            </span>
          </div>
        ) : null}
      </div>

      {/* The page continues below the card. A hard stop would read as a short
          document; the fade reads as the rest of the page. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[10%] bg-gradient-to-b from-transparent to-white" />
    </div>
  );
}
