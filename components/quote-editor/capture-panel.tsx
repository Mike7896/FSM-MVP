"use client";

import { useMemo, useState } from "react";
import {
  Camera,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Ruler,
  Search,
  StickyNote,
} from "lucide-react";

import { CaptureAdd } from "@/components/quote-editor/capture-add";
import { Input } from "@/components/ui/input";
import type { CaptureItem } from "@/lib/queries/captures";
import { cn } from "@/lib/utils";

/**
 * From the visit — the left column of the desk frame.
 *
 * **This is what the desk width is for.** The walkthrough on one side and the
 * quote on the other, permanently — not a modal, not a tab, not a drawer. He
 * cross-references what she said against what he is typing continuously for
 * twenty minutes, and that adjacency *is* the desk mode. Without it the desk
 * layout is the phone layout with more whitespace, which is the one failure the
 * second platform cannot afford.
 *
 * Ordered by when things were captured rather than grouped by kind, because the
 * panel is a record of a walkthrough: grouping the photos away from the note
 * taken thirty seconds later is what stops it answering "what did she say about
 * the hallway".
 *
 * Search is the feature the panel exists to serve — finding her words is how an
 * exclusion gets written in *her* terms, which is the difference between
 * "hallway excluded" and a line she recognises as the thing she asked for.
 */

const ICON = {
  note: StickyNote,
  photo: Camera,
  measurement: Ruler,
  audio: Mic,
} as const;

export function CapturePanel({
  captures,
  jobId,
  collapsed = false,
  onCollapsedChange,
  className,
}: {
  captures: CaptureItem[];
  /**
   * Null before the first autosave, when the Job does not exist yet. Adding is
   * hidden until it does rather than failing on a missing id — a capture
   * belongs to a Job and there is nowhere to put one.
   */
  jobId?: string | null;
  /** Folded to a spine. The column is still there; it is just not open. */
  collapsed?: boolean;
  onCollapsedChange?: (next: boolean) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return captures;
    return captures.filter(
      (capture) =>
        capture.body?.toLowerCase().includes(term) ||
        capture.flag?.toLowerCase().includes(term)
    );
  }, [captures, query]);

  if (collapsed) {
    return (
      <div
        data-tour="quote.capture"
        className={cn("flex flex-col items-center gap-3 py-3", className)}
      >
        <button
          type="button"
          onClick={() => onCollapsedChange?.(false)}
          title="Open what was captured on site"
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex size-8 items-center justify-center rounded-md transition-colors"
        >
          <PanelLeftOpen className="size-4" />
          <span className="sr-only">Open the visit</span>
        </button>

        {/* The count is the reason to open it, so it is the one thing the
            spine carries. */}
        {captures.length > 0 ? (
          <span className="text-muted-foreground text-[11px] tabular-nums">
            {captures.length}
          </span>
        ) : null}

        <span className="text-muted-foreground font-label [writing-mode:vertical-rl] text-[10px] uppercase">
          From the visit
        </span>
      </div>
    );
  }

  return (
    <div data-tour="quote.capture" className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <span
          data-tour-heading
          className="text-foreground/80 font-label text-xs leading-5 uppercase"
        >
          From the visit
        </span>
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {captures.length === 0
              ? "Nothing yet"
              : `${captures.length} item${captures.length === 1 ? "" : "s"}`}
          </span>
          {onCollapsedChange ? (
            <button
              type="button"
              onClick={() => onCollapsedChange(true)}
              title="Fold this away"
              className="text-muted-foreground hover:text-foreground hover:bg-muted flex size-6 items-center justify-center rounded transition-colors"
            >
              <PanelLeftClose className="size-3.5" />
              <span className="sr-only">Fold the visit away</span>
            </button>
          ) : null}
        </span>
      </div>

      {captures.length === 0 ? (
        /* An empty walkthrough is an ordinary state — a quote written from a
           phone call has no captures and is not missing anything. It says what
           would go here rather than apologising for a gap, and offers the one
           thing a desk can actually do about it. */
        <div className="text-muted-foreground px-4 py-5 text-sm leading-relaxed">
          <p className="text-foreground font-medium">Nothing captured yet.</p>
          <p className="mt-2 text-xs">
            Photos, measurements and notes from the walkthrough land here,
            beside the quote you write from them.
          </p>
          {jobId ? null : (
            <p className="mt-2 text-xs">
              You can drop them in as soon as this quote has somewhere to live —
              which happens the moment you type anything into it.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="border-b p-3">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search the visit"
                className="h-8 pl-8 text-sm"
              />
            </div>
            {query.trim() ? (
              <p className="text-muted-foreground mt-2 text-xs">
                {matches.length} of {captures.length}
              </p>
            ) : null}
          </div>

          {/* `min-h-0` lets the list shrink inside the capped panel and scroll,
              instead of pushing the intake off the bottom of the screen. */}
          <div className="flex min-h-0 flex-col divide-y overflow-y-auto [scrollbar-width:thin]">
            {matches.map((capture) => (
              <CaptureRow key={capture.id} capture={capture} query={query} />
            ))}
            {matches.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-sm">
                Nothing in the visit matches that.
              </p>
            ) : null}
          </div>
        </>
      )}

      {/* Intake, not capture. The real capture surface is the native app; what
          the desk needs is somewhere to put the photographs already on his
          phone, and the enquiry photographs a customer emailed in. */}
      {jobId ? (
        <div className="mt-auto">
          <CaptureAdd jobId={jobId} />
        </div>
      ) : null}
    </div>
  );
}

function CaptureRow({
  capture,
  query,
}: {
  capture: CaptureItem;
  query: string;
}) {
  const Icon = ICON[capture.kind];
  const time = new Date(capture.capturedAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex gap-3 px-4 py-3">
      {capture.kind === "photo" && capture.fileUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element --
           Capture photos are signed storage URLs with no known dimensions and a
           short expiry. next/image would need a remote pattern per bucket and
           would re-fetch through the optimizer after the signature expired. */
        <img
          src={capture.fileUrl}
          alt={capture.body ?? "Capture from the visit"}
          className="size-14 shrink-0 rounded border object-cover"
        />
      ) : (
        <div className="text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded border">
          <Icon className="size-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {capture.flag ? (
          <span className="text-muted-foreground border-muted-foreground/40 mb-1 inline-block rounded border px-1 font-label text-[9px] uppercase">
            {capture.flag}
          </span>
        ) : null}
        <p className="text-sm leading-snug">
          <Highlight text={capture.body ?? "Untitled capture"} query={query} />
        </p>
        <p className="text-muted-foreground mt-1 text-[10px] tabular-nums">
          {time}
        </p>
      </div>
    </div>
  );
}

/** Marks the searched words so his eye lands on why the row matched. */
function Highlight({ text, query }: { text: string; query: string }) {
  const term = query.trim();
  if (!term) return <>{text}</>;

  const parts = text.split(new RegExp(`(${escapeRegExp(term)})`, "ig"));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={index} className="bg-primary/20 text-foreground rounded-sm">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
