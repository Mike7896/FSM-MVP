import Link from "next/link";
import { Eye, FileText, LayoutList, PencilLine } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * View or Edit — the two things you can be doing to a document.
 *
 * **One surface, two modes.** A quote is a document you read and a document
 * you write, and those are the same object seen two ways rather than two
 * places in the product. The control sits in the same spot in both, so
 * switching feels like turning the page over, not like navigating.
 *
 * Two links rather than a toggle with state: each mode is a real address, so
 * it can be bookmarked, opened in a tab, and sent to somebody — and the server
 * renders whichever one was asked for with nothing to hydrate.
 */
export function DocumentModeSwitch({
  mode,
  viewHref,
  editHref,
  className,
}: {
  mode: "view" | "edit";
  viewHref: string;
  editHref: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="How you're looking at this"
      className={cn(
        "bg-muted/60 flex shrink-0 items-center gap-0.5 rounded-md p-0.5",
        className
      )}
    >
      <Mode href={viewHref} active={mode === "view"} icon={Eye} label="View" />
      <Mode
        href={editHref}
        active={mode === "edit"}
        icon={PencilLine}
        label="Edit"
      />
    </div>
  );
}

/**
 * Overview or Document — the contract's two pages.
 *
 * **Nobody edits a contract**, so it has no Edit; what it has instead is a
 * life after it was written — signatures, sends, the deposit, the changes —
 * and that belongs on an ordinary screen rather than drawn over the paper.
 * Same control, same place, as the quote's View and Edit.
 */
export function ContractModeSwitch({
  mode,
  jobId,
  className,
}: {
  mode: "overview" | "document";
  jobId: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="How you're looking at this"
      className={cn(
        "bg-muted/60 flex shrink-0 items-center gap-0.5 rounded-md p-0.5",
        className
      )}
    >
      <Mode
        href={`/jobs/${jobId}/contract`}
        active={mode === "overview"}
        icon={LayoutList}
        label="Overview"
      />
      <Mode
        href={`/jobs/${jobId}/contract/view`}
        active={mode === "document"}
        icon={FileText}
        label="Document"
      />
    </div>
  );
}

function Mode({
  href,
  active,
  icon: Icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: typeof Eye;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </Link>
  );
}

/**
 * Back to where a sent quote stands — sent, opened, approved — from the quote
 * itself. The send confirmation is the screen that answers "did she open it?",
 * and it has to be reachable again after you've left it, not only on the way
 * out of sending.
 */
export function StandingLink({ quoteId, status }: { quoteId: string; status: string }) {
  if (status === "draft") return null;
  const tone =
    status === "accepted"
      ? "bg-emerald-500"
      : status === "viewed"
        ? "bg-sky-500"
        : status === "declined" || status === "expired"
          ? "bg-destructive"
          : "bg-amber-500";
  return (
    <Link
      href={`/quotes/${quoteId}/sent`}
      className="hover:bg-muted text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors"
      title="Sent, opened, approved — and what to do next"
    >
      <span className={cn("size-1.5 rounded-full", tone)} />
      <span className="capitalize">{status}</span>
      <span aria-hidden>·</span>
      Where it stands
    </Link>
  );
}
