"use client";

import type { ReactNode } from "react";
import { ChevronLeft, Loader2, Check, AlertCircle } from "lucide-react";

import { DemoChip } from "@/components/demo-chip";
import { Button } from "@/components/ui/button";
import type { QuoteDraft } from "@/lib/quote";

/**
 * The editor's chrome — **not the document's Header section.**
 *
 * Those were one thing and are now two, because they answer to different
 * people. This bar belongs to the app: close, whether it saved, and the send
 * action. The Header *section* belongs to the document — parties, address,
 * number, dates, the license, the document type word — and the customer reads
 * every word of it. Editing the customer's name from a toolbar was the tell
 * that the two had been conflated.
 *
 * **The primary action lives here, not at the bottom of a rail.** That is where
 * 19a puts it and it is the right place: Preview is reachable from the first
 * second at any scroll position, and nothing gates it — not a complete profile,
 * not a filled section. The anxiety this screen fights is *am I going to lose
 * money on this, and am I about to look like an amateur*, and a primary action
 * that scrolls away reads as a form to finish rather than a document to send.
 *
 * The name shown here is a **label**, deliberately. It is the same string the
 * Header section edits, and two live inputs for one field at two places on the
 * screen is a synchronisation bug waiting for a slow keystroke.
 */
export function EditorHeader({
  draft,
  status,
  error,
  previewLabel,
  onPreview,
  preparing,
  onBack,
  showAction = true,
  actions,
  demo = false,
  kind,
}: {
  draft: QuoteDraft;
  status: string;
  error: string | null;
  previewLabel: string;
  onPreview: () => void;
  preparing: boolean;
  onBack?: () => void;
  /**
   * Off at phone width, where the header scrolls away and the action lives at
   * the foot of the document instead (4e). Never off because something is
   * incomplete — nothing gates Preview.
   */
  showAction?: boolean;
  /** Controls that belong to the surface — the tour's replay, in activation. */
  actions?: ReactNode;
  /**
   * A demo quote. The chip and one line are the only difference — nothing is
   * disabled and nothing is watermarked (14a).
   */
  demo?: boolean;
  /** "Change order" — the document's own word, where it isn't a quote. */
  kind?: string;
}) {
  const name = draft.customerName.trim();
  const title = draft.title.trim();

  return (
    // `min-h-16` holds the bar at exactly the 4rem the rail and the capture
    // panel stick beneath, with or without the demo line under the name.
    <div className="bg-background sticky top-0 z-10 flex min-h-16 items-center justify-between gap-4 border-b px-4 py-2 @2xl:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {onBack ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Close — back to Quotes"
            className="text-muted-foreground -ml-2 size-8 shrink-0"
          >
            <ChevronLeft className="size-4" />
          </Button>
        ) : null}

        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 truncate">
              {kind ? (
                <span className="text-muted-foreground text-sm">
                  {kind}
                  {draft.number ? ` ${draft.number}` : ""} ·{" "}
                </span>
              ) : null}
              <span className="text-base font-semibold">
                {name || "New quote"}
              </span>
              {title ? (
                <span className="text-muted-foreground text-sm"> — {title}</span>
              ) : null}
            </div>
            {demo ? <DemoChip /> : null}
          </div>
          {demo ? (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              A demo. It stays in your account, labelled, and never counts
              toward anything.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {actions}
        <SaveState status={status} error={error} number={draft.number} />
        {showAction ? (
          <Button data-tour="quote.preview" onClick={onPreview} disabled={preparing}>
            {preparing ? <Loader2 className="animate-spin" /> : null}
            {previewLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What happened to the last save.
 *
 * A failed write is stated plainly and reassuringly — the changes really are
 * still on screen and the next keystroke retries. Silence is the thing to
 * avoid: a contractor who cannot tell whether his quote is saved retypes it
 * somewhere else.
 */
function SaveState({
  status,
  error,
  number,
}: {
  status: string;
  error: string | null;
  /** `Q-0007` once the first save has given the quote its row. */
  number: string | null;
}) {
  if (status === "error") {
    return (
      <span
        title={error ?? undefined}
        className="text-destructive flex items-center gap-1 font-label text-[10px] uppercase"
      >
        <AlertCircle className="size-3" />
        Not saved
      </span>
    );
  }

  return (
    <span
      className="text-muted-foreground hidden items-center gap-1 font-label text-[10px] uppercase @md:flex"
      title={number ?? undefined}
    >
      {status === "saving" ? (
        <>
          <Loader2 className="size-3 animate-spin" />
          Saving
        </>
      ) : number === null ? (
        // Nothing written yet — a new quote before its first save, or a first
        // quote before the Office it will live in exists. "Saved" here would be
        // a promise the page can't keep if the tab closes now (4a).
        "Draft"
      ) : (
        <>
          <Check className="size-3" />
          Saved
        </>
      )}
    </span>
  );
}
