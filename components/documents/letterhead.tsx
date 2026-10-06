import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The top of a document: the business's name block, its logo beside it, and
 * for a bold header a solid band behind both — the Office's look
 * (`lib/branding`). The quote projection and the paper view both draw it, so
 * the branding preview and the page the customer opens can't disagree.
 *
 * The band is ink, not a colour of the business's choosing: there is no colour
 * picker, and amber is ServiceClerk's, not the contractor's. A logo on the band
 * sits on a white tile so a dark mark still reads.
 */
export function Letterhead({
  logoUrl,
  bold = false,
  children,
}: {
  /** Already decided: null when the look or the plan leaves the logo off. */
  logoUrl?: string | null;
  bold?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3",
        bold &&
          "rounded-md bg-paper-ink px-4 py-3 text-white [&_.text-muted-foreground]:text-white/70"
      )}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a public image the business uploaded, drawn at whatever size it is
        <img
          src={logoUrl}
          alt=""
          className={cn(
            "block h-10 w-auto max-w-[180px] shrink-0 object-contain",
            bold && "rounded bg-white p-1"
          )}
        />
      ) : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
