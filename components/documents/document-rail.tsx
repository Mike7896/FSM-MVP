import { DocumentCard } from "@/components/documents/document-card";
import { inkFor } from "@/components/documents/ink";
import { cn } from "@/lib/utils";
import type { JobDocument } from "@/lib/queries/job-documents";

/**
 * Every document on a job, left to right, in the order it happened.
 *
 * **The job's story, told in its own paperwork.** Four quiet rows saying "the
 * quote · the contract · change orders · receipts" is a directory; the same
 * four documents laid out in time is a narrative a contractor can read in one
 * pass — *she was quoted this, she agreed to that, the meter socket was
 * corroded so it changed, and here is what she has been billed since.*
 *
 * **Oldest first, and it scrolls rather than wraps.** Wrapping would put the
 * fifth document under the first and break the one thing the layout is for:
 * time runs in a straight line. The rail is horizontally scrollable at every
 * width, so a long job reads the same way on a phone as at the desk.
 *
 * The date above each card is what makes it a sequence rather than a row of
 * cards — without it the order is an assertion the reader has to take on faith.
 */
export function DocumentRail({
  documents,
  businessName,
  license,
  customerName,
}: {
  documents: JobDocument[];
  businessName: string | null;
  license: string | null;
  customerName: string | null;
}) {
  if (documents.length === 0) return null;

  return (
    /* Negative margin so the rail bleeds to the edge of the content region:
       a scroll area that stops short of the edge looks like it has ended. */
    <div className="-mx-2 overflow-x-auto px-2 pb-3">
      <ol className="flex w-max items-start gap-3">
        {documents.map((document) => (
          <li key={`${document.kind}-${document.id}`} className="w-[168px] shrink-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span className={cn("size-1.5 shrink-0 rounded-full", inkFor(document.documentType).dot)} />
              <span className="text-muted-foreground font-label text-[10px] uppercase">
                {document.documentType}
              </span>
              <span className="text-muted-foreground text-[10px] tabular-nums">
                {when(document.at)}
              </span>
            </div>

            <DocumentCard
              href={document.href}
              businessName={businessName}
              license={license}
              customerName={customerName}
              title={document.title}
              number={document.number}
              documentType={document.documentType}
              rows={document.rows}
              totalCents={document.totalCents}
              status={document.status.replace(/_/g, " ")}
              statusVariant={variantFor(document)}
              // The customer is the same on every card here and is already in
              // the page header; what varies is the document itself.
              caption={document.title ?? document.documentType}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function when(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Status colour, by what the status *means* rather than by what it is called.
 *
 * The four document types have four different status sets and no shared enum —
 * `approved`, `signed` and `paid` are the same good news wearing three words —
 * so the mapping is on meaning, and anything unrecognised stays quiet rather
 * than being coloured by accident.
 */
function variantFor(
  document: JobDocument
): "default" | "secondary" | "outline" | "destructive" {
  const status = document.status;

  if (status === "declined") return "destructive";
  if (status === "overdue") return "destructive";
  if (["approved", "signed", "paid", "viewed"].includes(status)) return "default";
  if (["sent", "issued"].includes(status)) return "secondary";
  return "outline";
}
