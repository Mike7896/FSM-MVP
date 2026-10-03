"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A yes/no the browser remembers — a collapsed panel, a chosen view.
 *
 * **The browser, not the account.** What this protects is a preference about
 * one screen on one machine; a column somebody's phone and their desk have to
 * agree about is a migration for no gain. If one of these ever needs to follow
 * a person, it becomes a field on the profile and the call sites don't change.
 *
 * `useSyncExternalStore` rather than state filled in by an effect: storage is
 * exactly the external store it is for, and the server snapshot is the default,
 * so the markup React renders on the server and the markup it hydrates with
 * agree. The real answer arrives in the pass after hydration.
 */
const CHANGED = "sticky-toggle:changed";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

export function useStickyToggle(
  key: string,
  fallback: boolean
): readonly [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : raw === "1";
      } catch {
        // Private windows and blocked storage: the default, every time.
        return fallback;
      }
    },
    () => fallback
  );

  const set = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* nothing to do, and nothing worth telling anybody about */
      }
      // Same-tab writes don't raise `storage`, so this is what tells the
      // subscribers to look again.
      window.dispatchEvent(new Event(CHANGED));
    },
    [key]
  );

  return [value, set] as const;
}

/**
 * The same, for one of a few named choices — which tab a panel was left on.
 * A stored value that is no longer one of `choices` reads as the fallback.
 */
export function useStickyChoice<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: T
): readonly [T, (next: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        const raw = window.localStorage.getItem(key);
        return raw !== null && (choices as readonly string[]).includes(raw)
          ? (raw as T)
          : fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback
  );

  const set = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* as above */
      }
      window.dispatchEvent(new Event(CHANGED));
    },
    [key]
  );

  return [value, set] as const;
}
