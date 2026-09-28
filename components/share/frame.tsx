import type { ReactNode } from "react";
import { Download } from "lucide-react";

import { inkFor } from "@/components/documents/ink";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The frame around the paper on the customer's link — the bar above it and
 * the panel below it.
 *
 * **The page is the document; everything you can do is outside it.** A quote
 * with an Approve button printed on it reads as a web form; the same quote on
 * a sheet, with the button under the sheet, reads as a document someone is
 * asking you to agree to — which is what it is. So the paper carries only
 * what would print, and the actions sit in a panel below it.
 *
 * **The bar keeps the action in reach.** A long quote on a phone puts the
 * panel a few screens down, so the bar pinned to the top carries a shortcut to
 * it — and the one thing a document needs that a page doesn't: a copy to keep.
 */
export function ShareBar({
  business,
  label,
  ink,
  number,
  pdfHref,
  respond,
}: {
  business: string | null;
  /** "Quote", "Contract", "Change order", "Deposit invoice". */
  label: string;
  /** The document type whose ink it wears — "Invoice" for any invoice. */
  ink: string;
  number: string | null;
  pdfHref: string;
  /** The shortcut to the panel below the page, when there's something to do. */
  respond?: string | null;
}) {
  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20 border-b backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-[calc(8.5in+3rem)] items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {business ?? "Your contractor"}
          </p>
          <p className="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
            <span className={cn("size-1.5 shrink-0 rounded-full", inkFor(ink).dot)} />
            {[label, number].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <a href={`${pdfHref}?download=1`} aria-label="Download a PDF copy">
              <Download />
              <span className="hidden sm:inline">Download PDF</span>
              <span className="sm:hidden">PDF</span>
            </a>
          </Button>
          {respond ? (
            <Button asChild size="sm">
              <a href="#respond">{respond}</a>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/**
 * The panel under the page — where she answers it. A card on the desk, the
 * width of the paper, so it reads as belonging to the document above it
 * without being printed on it.
 */
export function ResponsePanel({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      id="respond"
      className={cn(
        "bg-background mx-4 flex scroll-mt-20 flex-col gap-4 rounded-xl border p-5 shadow-[0_1px_3px_rgb(22_32_42/0.06)] sm:mx-0 sm:p-6 print:hidden",
        className
      )}
    >
      {title || description ? (
        <div>
          {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
          {description ? (
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
