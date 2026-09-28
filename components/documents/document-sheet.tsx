import type { ReactNode } from "react";

import { Lockup } from "@/components/brand";
import { cn } from "@/lib/utils";

/**
 * The page a document is printed on — a real one, at a real size.
 *
 * **US Letter with one-inch margins**, which is what Word and Google Docs hand
 * somebody who opens a blank document, and what every printer in every
 * contractor's office is loaded with. The measure that falls out of it — 6.5
 * inches — is also about seventy characters a line, which is where prose stops
 * being tiring to read. So the page stops at its own width however wide the
 * window gets, and keeps its full height even when the quote is four lines
 * long: a short document is a short document on a whole sheet of paper, not a
 * small piece of paper.
 *
 * **One sheet, every surface.** The homeowner's link, the contractor's view
 * mode, the print and the miniature beside the Office forms are the same
 * component on the same paper — so what he checks, what she opens and what
 * comes out of the printer cannot drift apart. When a server-rendered PDF
 * lands it renders this, rather than a second template that slowly disagrees.
 *
 * `size="note"` is the miniature — the same page, smaller. It keeps Letter's
 * proportions and Letter's margin *ratio* (one inch in eight and a half, so
 * 11.8% of whatever width it is given) rather than an inch of padding that
 * would eat a side column alive, and it holds the page's shape when the
 * document is short. A preview of a document has to be a small document; a
 * differently-padded box is a preview of nothing.
 */
export function DocumentSheet({
  children,
  size = "page",
  footer,
  className,
}: {
  children: ReactNode;
  size?: "page" | "note";
  /** What sits under the last rule — the identity line and the mark. */
  footer?: ReactNode;
  className?: string;
}) {
  const sheet = (
    <article
      className={cn(
        // A container, so what is laid out on the page answers to the page's
        // width — the miniature is narrow on a wide screen.
        "document-paper @container mx-auto flex w-full flex-col",
        // A hairline and a whisper of shadow: enough to read as a sheet lying
        // on the desk behind it, not enough to read as a card in an app.
        "border-paper-rule border shadow-[0_1px_3px_rgb(22_32_42/0.08)]",
        size === "page"
          ? // 8.5in × 11in, one-inch margins — and on a phone, where an inch
            // of margin is a third of the screen, the page keeps its
            // proportions but not its indulgence. Nor its length: eleven
            // inches of a four-line quote on a phone is a screen and a half
            // of blank paper between her and the button under it.
            "w-[8.5in] max-w-full p-7 sm:min-h-[11in] sm:p-[1in]"
          : // The same page at side-column width: Letter's shape, Letter's
            // margin ratio, and type scaled with it so the measure still
            // reads. `aspect-ratio` holds the page's shape while the document
            // is short and gives way when it isn't.
            "aspect-[8.5/11] w-full max-w-md p-[11.8%] text-[9.5pt]",
        "print:border-0 print:shadow-none",
        className
      )}
    >
      <div className="flex-1">{children}</div>
      {/* Pushed to the foot of the page by the flexed body above it, with a
          line of air in case the document runs the whole way down. */}
      {footer ? <div className="mt-6 shrink-0">{footer}</div> : null}
    </article>
  );

  // **The miniature sits in an ordinary block, whatever column it is put in.**
  // Its Letter shape is meant as a floor — grow when the document runs longer.
  // As a flex item it isn't: flexbox caps an aspect-ratio item's minimum height
  // at the shape, so a long document ran out of the bottom of the page and
  // over whatever sat beneath it. In block layout the shape gives way.
  //
  // The wrapper is the page's own width, not the column's: the margins are a
  // percentage, and a percentage of padding is taken from the containing
  // block — so a column-wide wrapper would nearly double them.
  return size === "note" ? (
    <div className="mx-auto w-full max-w-md min-w-0">{sheet}</div>
  ) : (
    sheet
  );
}

/**
 * The desk the sheet lies on.
 *
 * A document needs something behind it or it stops looking like an object —
 * and the contrast is what makes an inch of margin read as a margin rather
 * than as empty space in a layout.
 */
export function DocumentDesk({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-muted/40 flex justify-center px-0 py-0 sm:px-6 sm:py-8",
        "print:bg-transparent print:p-0",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * The foot of the page: whose document this is on the left, and the mark on
 * the right.
 *
 * **The mark is on the paper, not around it.** A printed copy and a PDF are
 * the versions that travel — pinned to a fridge, forwarded to a spouse, handed
 * to a lender — and a footer that only exists in the web page is a footer that
 * never goes anywhere. It is small, grey and last, because it is ours and the
 * rest of the page is theirs.
 */
export function DocumentFooter({
  businessName,
  number,
  promo = true,
  className,
}: {
  businessName: string | null;
  /** `Q-0007` — what this document is called, where it has a name. */
  number?: string | null;
  /**
   * The mark itself — Free-plan documents only, decided by the plan the
   * document went out on (Billing §2.2).
   */
  promo?: boolean;
  className?: string;
}) {
  const left = [number, businessName].filter(Boolean).join(" · ");

  return (
    <footer
      className={cn(
        // Relative to whatever the sheet is set in, so the miniature's footer
        // shrinks with the miniature rather than shouting at it.
        "text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[0.82em]",
        className
      )}
    >
      <span className="min-w-0 truncate">{left}</span>
      {promo ? (
        <span className="flex shrink-0 items-center gap-1.5">
          Made with <Lockup size={13} />
        </span>
      ) : null}
    </footer>
  );
}
