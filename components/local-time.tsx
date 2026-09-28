"use client";

import { useSyncExternalStore } from "react";

/**
 * A moment, in the reader's own time zone.
 *
 * **The server doesn't know where the reader is.** On a host it runs in UTC,
 * so "signed at 2:24 PM" formatted there is wrong for everyone reading it in
 * California — and on a record of who signed when, a wrong time is worse than
 * none. So the time is formatted in the browser, after hydration; the server's
 * render is a placeholder in the same shape, replaced before anyone reads it.
 */
export function LocalTime({
  iso,
  format = "datetime",
}: {
  /** ISO string — a `Date` doesn't cross to a Client Component. */
  iso: string;
  format?: "date" | "datetime";
}) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const date = new Date(iso);
  const options: Intl.DateTimeFormatOptions =
    format === "date"
      ? { month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

  return (
    <time dateTime={iso}>
      {date.toLocaleString(
        "en-US",
        inBrowser ? options : { ...options, timeZone: "UTC" }
      )}
    </time>
  );
}

function subscribe() {
  return () => {};
}
