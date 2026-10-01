"use client";

import { useState } from "react";
import { Camera, Mic, Ruler, StickyNote } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { CaptureItem } from "@/lib/queries/captures";
import { cn } from "@/lib/utils";

const KINDS = {
  photo: { label: "Photo", icon: Camera },
  note: { label: "Note", icon: StickyNote },
  measurement: { label: "Measurement", icon: Ruler },
  audio: { label: "Audio", icon: Mic },
} as const;

/** A compact walkthrough in capture order, with full previews on the job. */
export function CaptureRail({ captures }: { captures: CaptureItem[] }) {
  return (
    <div
      role="region"
      aria-label="Visit captures"
      tabIndex={0}
      className="mt-3 -mx-1 overflow-x-auto rounded px-1 pb-2 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <ol className="flex w-max items-start gap-3">
        {captures.map((capture) => (
          <li key={capture.id} className="w-[200px] shrink-0">
            <CaptureCard capture={capture} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function CaptureCard({ capture }: { capture: CaptureItem }) {
  const { label, icon: Icon } = KINDS[capture.kind];
  const date = new Date(capture.capturedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <Dialog>
      <div className="text-muted-foreground mb-1.5 flex items-center gap-2 text-[10px]">
        <Icon className="size-3" aria-hidden="true" />
        <span className="font-label uppercase">{label}</span>
        <time dateTime={capture.capturedAt} className="ml-auto tabular-nums">{date}</time>
      </div>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Open ${label.toLowerCase()}: ${capture.body || date}`}
          className="bg-card hover:border-primary/50 flex h-[224px] w-full flex-col overflow-hidden rounded-lg border text-left shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {capture.kind === "photo" ? (
            <>
              <CapturePhoto capture={capture} className="h-[156px] w-full shrink-0 object-cover" />
              <p className="line-clamp-2 px-3 pt-2.5 text-xs leading-relaxed break-words">
                {capture.body || "Photo from the visit"}
              </p>
            </>
          ) : (
            <div className={cn(
              "flex min-h-0 flex-1 flex-col p-4",
              capture.kind === "note" && "bg-amber-50/60 dark:bg-amber-950/15",
              capture.kind === "measurement" && "bg-primary/[0.04]",
            )}>
              <Icon className="text-muted-foreground mb-3 size-5 shrink-0" aria-hidden="true" />
              <p className={cn(
                "line-clamp-5 whitespace-pre-wrap text-sm leading-relaxed break-words",
                capture.kind === "measurement" && "text-lg font-medium tabular-nums",
              )}>
                {capture.body || (capture.kind === "audio" ? "Voice recording" : `Untitled ${label.toLowerCase()}`)}
              </p>
            </div>
          )}
          {capture.flag ? (
            <span className="text-muted-foreground mt-auto block w-full truncate border-t px-3 py-1.5 text-[10px]">
              {capture.flag}
            </span>
          ) : null}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <DialogTitle>{label} from the visit</DialogTitle>
          <DialogDescription>{date}{capture.flag ? ` · ${capture.flag}` : ""}</DialogDescription>
        </DialogHeader>
        {capture.kind === "photo" ? (
          <CapturePhoto capture={capture} className="max-h-[55dvh] w-full rounded object-contain" />
        ) : null}
        {capture.kind === "audio" ? (
          capture.fileUrl ? (
            <audio controls preload="none" src={capture.fileUrl} className="w-full" aria-label="Visit recording" />
          ) : <p className="text-muted-foreground text-sm">Recording unavailable.</p>
        ) : null}
        {capture.body ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed break-words">{capture.body}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CapturePhoto({ capture, className }: { capture: CaptureItem; className: string }) {
  const [failed, setFailed] = useState(false);

  if (!capture.fileUrl || failed) {
    return (
      <div className={cn("bg-muted text-muted-foreground flex min-h-32 flex-col items-center justify-center gap-2 text-xs", className)}>
        <Camera className="size-6" aria-hidden="true" />
        <span>Photo unavailable</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- Private, short-lived signed URLs are loaded directly, matching the capture panel.
    <img
      src={capture.fileUrl}
      alt={capture.body || "Photo from the visit"}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
