"use client";

import { timeLabel } from "@/lib/schedule/dates";

/**
 * "Tue 8 AM" on the reader's own clock.
 *
 * A server page knows the instant a visit starts but not the wall it's read
 * on, so the browser prints it. The server's first guess may differ by a time
 * zone; the browser's answer replaces it, which is what the warning
 * suppression is for.
 */
export function LocalWhen({ at }: { at: string }) {
  const date = new Date(at);
  return (
    <span suppressHydrationWarning>
      {date.toLocaleDateString("en-US", { weekday: "short" })} {timeLabel(date)}
    </span>
  );
}
