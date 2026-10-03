"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "invalid" | "error";

/**
 * Where an Office page that saves itself says so. Always on screen, so there
 * is never a moment to wonder whether a change landed.
 */
export function SaveStatus({
  state,
  error,
  onRetry,
  className,
}: {
  state: SaveState;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-1.5 text-[13px]",
        state === "error" || state === "invalid"
          ? "text-destructive"
          : "text-muted-foreground",
        className
      )}
    >
      {state === "saving" ? (
        <>
          <Loader2 className="size-3.5 animate-spin" />
          Saving…
        </>
      ) : state === "pending" ? (
        "Unsaved changes…"
      ) : state === "saved" ? (
        <>
          <Check className="text-positive size-3.5" />
          Saved
        </>
      ) : state === "invalid" ? (
        <>
          <AlertCircle className="size-3.5" />
          Fix the highlighted field to save
        </>
      ) : state === "error" ? (
        <>
          <AlertCircle className="size-3.5" />
          {error ?? "Couldn't save."}
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="font-medium underline underline-offset-4"
            >
              Try again
            </button>
          ) : null}
        </>
      ) : (
        "Changes save automatically"
      )}
    </p>
  );
}
