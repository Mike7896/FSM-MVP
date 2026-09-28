import Link from "next/link";

import {
  DocumentThumbnail,
  type ThumbnailRow,
} from "@/components/documents/document-thumbnail";
import { DemoChip } from "@/components/demo-chip";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * One document on a shelf — drawn as a sheet of paper, not as a card.
 *
 * **The whole tile is the page.** Square corners, a dog-eared top-left, and a
 * shadow that lifts on hover: a shelf of quotes should read the way a stack of
 * paper on a desk reads, at a glance and from across the room. A rounded card
 * with a data bar under it reads as an interface listing documents, which is a
 * different thing to look at.
 *
 * **The facts arrive on hover, over the page, never printed on it.** Status,
 * money and standing are *about* the document rather than *in* it — putting a
 * status badge on the miniature would be printing it on the customer's copy.
 * So the page dims under a wash and the facts sit in the middle of it, which
 * also means nothing is permanently covering the words that tell two documents
 * apart.
 *
 * The whole tile is the link. A tile with an "Open" button asks the contractor
 * to aim at a 60px target inside the 200px one he was already pointing at.
 */

export type DocumentCardProps = {
  href: string;
  businessName: string | null;
  license: string | null;
  customerName: string | null;
  title: string | null;
  rows: ThumbnailRow[];
  totalCents: number;
  documentType?: string;
  number?: string | null;
  status: string;
  statusVariant?: "default" | "secondary" | "outline" | "destructive";
  /**
   * "Sent 5 days ago", "Opened twice" — the fact he is actually waiting on.
   * Omitted where the surface already says it: on a job's rail the date sits
   * above the card, and repeating it under one is noise in 168px.
   */
  standing?: string;
  /**
   * The name the tile is known by, shown with the facts on hover.
   *
   * Defaults to the customer, which is what identifies a document on a shelf of
   * many customers. On one job every card has the same customer, so the rail
   * passes what actually varies — the document's own title.
   */
  caption?: string | null;
  /** A demo document. The chip rides it onto every shelf it sits on. */
  demo?: boolean;
};

export function DocumentCard({
  href,
  businessName,
  license,
  customerName,
  title,
  rows,
  totalCents,
  documentType,
  number,
  status,
  statusVariant = "outline",
  standing,
  caption,
  demo = false,
}: DocumentCardProps) {
  return (
    <Link
      href={href}
      className="group focus-visible:ring-ring/50 relative block outline-none focus-visible:ring-3"
    >
      {/* The sheet. The clipped corner is a real cut in the shape rather than a
          drawn triangle, so the page behind it genuinely isn't there. */}
      <div
        className="document-tile relative bg-white text-[#111]"
      >
        <DocumentThumbnail
          businessName={businessName}
          license={license}
          customerName={customerName}
          title={title}
          rows={rows}
          totalCents={totalCents}
          documentType={documentType}
          number={number}
        />

        {/* The fold's underside: the little triangle of paper turned over,
            catching a shade less light than the face of the sheet. */}
        <span
          aria-hidden
          className="absolute top-0 left-0 size-[14px] bg-[#e4e6e8] [clip-path:polygon(0_0,100%_100%,0_100%)]"
        />

        {/* What the document is doing, over the page, only while reached for.
            `backdrop-blur` on the wash keeps the page legible as a page
            underneath rather than hiding it behind a panel. */}
        <div
          className={cn(
            // `document-paper` so the badge and the chip inside resolve to
            // paper's own ink and rules — a theme-coloured badge is invisible
            // on a white wash the moment the interface is dark.
            "document-paper absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center",
            "bg-white/75! opacity-0 backdrop-blur-[2px] transition-opacity",
            "group-hover:opacity-100 group-focus-visible:opacity-100"
          )}
        >
          <span
            title={caption ?? customerName ?? undefined}
            className="line-clamp-2 text-sm font-medium text-[#16202a] capitalize"
          >
            {caption ?? customerName ?? "New customer"}
          </span>

          <span className="text-base font-semibold text-[#16202a] tabular-nums">
            {formatMoney(totalCents)}
          </span>

          <span className="flex flex-wrap items-center justify-center gap-1.5">
            <Badge variant={statusVariant} className="capitalize">
              {status}
            </Badge>
            {demo ? <DemoChip /> : null}
          </span>

          {standing ? (
            <span className="line-clamp-2 text-xs text-[#667485]">
              {standing}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

/** The shelf. Wide enough that a thumbnail is legible, no wider. */
export function DocumentShelf({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {children}
    </div>
  );
}
