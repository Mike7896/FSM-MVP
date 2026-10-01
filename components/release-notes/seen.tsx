"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  RELEASE_NOTES_ROUTE,
  RELEASE_NOTES_TITLE,
} from "@/lib/release-notes/entries";

/**
 * Whether this person has seen the latest entry.
 *
 * **Kept in the browser, not the account.** What it protects is a dot, and a
 * dot that reappears on a second computer costs nobody anything — where a
 * migration and a column on every person would. If it ever needs to follow
 * somebody between their phone and the desk, it becomes a field on the
 * profile and nothing else about this changes.
 */
const KEY = "release-notes:seen";

/** The same event the page fires when it marks everything read. */
const CHANGED = "release-notes:changed";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // Private windows and blocked storage: everything is unseen, forever.
    return null;
  }
}

/**
 * How many entries this browser hasn't seen.
 *
 * `useSyncExternalStore` rather than state filled in by an effect: local
 * storage is exactly the external store it is for, and the server snapshot
 * says "nothing new" so the markup React renders on the server and the markup
 * it hydrates with are the same. The dot appears in the pass after hydration,
 * which is the earliest moment the answer is actually known.
 */
let published: string[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
function loadPublished() {
  loading ??= fetch("/api/v1/releases").then(async response => {
    if (!response.ok) throw new Error("Release notes unavailable");
    const result = await response.json();
    published = result.data.map((entry: { publishedAt: string }) => entry.publishedAt);
    listeners.forEach(listener => listener());
  }).catch(() => {}).finally(() => { loading = null; });
}
function subscribePublished(listener: () => void) {
  listeners.add(listener);
  loadPublished();
  window.addEventListener("focus", loadPublished);
  return () => { listeners.delete(listener); window.removeEventListener("focus", loadPublished); };
}
function useUnseen(): number {
  const seen = useSyncExternalStore(subscribe, read, () => "");
  const dates = useSyncExternalStore(subscribePublished, () => published, () => EMPTY);
  return dates.filter(date => !seen || date > seen).length;
}
const EMPTY: string[] = [];

/** Marks everything up to the newest entry as seen. Rendered by the page. */
export function MarkReleaseNotesSeen({ latest }: { latest: string }) {
  useEffect(() => {
    try {
      if (latest && latest > (read() ?? "")) window.localStorage.setItem(KEY, latest);
      // Same-tab writes don't raise `storage`, so the dot beside the nav would
      // sit there until a reload. This is what tells it to look again.
      window.dispatchEvent(new Event(CHANGED));
    } catch {
      /* nothing to do, and nothing worth telling anybody about */
    }
  }, [latest]);

  return null;
}

/** The dot beside the nav entry. Nothing at all when there is nothing new. */
export function ReleaseNotesDot() {
  const unseen = useUnseen();
  if (!unseen) return null;

  return (
    <span
      aria-label={`${unseen} new`}
      className="bg-primary ml-auto size-1.5 shrink-0 rounded-full"
    />
  );
}

/**
 * The line on the dashboard — the app's own front page, which is where
 * somebody finds out the product moved without going looking for it.
 *
 * It disappears once it has been read, because a permanent banner is furniture
 * rather than news.
 */
export function ReleaseNotesNews() {
  const unseen = useUnseen();
  if (!unseen) return null;

  return (
    <Link
      href={RELEASE_NOTES_ROUTE}
      className="bg-card hover:bg-muted/50 dark:hover:bg-muted flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors"
    >
      <span className="min-w-0 text-sm">
        <span className="font-medium">{RELEASE_NOTES_TITLE}</span>
        <span className="text-muted-foreground">
          {" · "}
          {unseen === 1
            ? "something new since you last looked"
            : `${unseen} updates since you last looked`}
        </span>
      </span>
      <ArrowRight className="text-muted-foreground size-4 shrink-0" />
    </Link>
  );
}
