"use client";

import { useCallback, useSyncExternalStore, type RefObject } from "react";

/**
 * Which frame the editor is wearing, measured from **its own container**.
 *
 * A viewport breakpoint is the wrong question here and has already been wrong
 * once: the editor is mounted in a `max-w-6xl` page and in a narrow activation
 * column on the same 1280px screen, so `lg:` reports "desktop" in both and lays
 * out a rail neither can necessarily fit.
 *
 * Most of the responsive work is plain CSS container queries. This hook exists
 * for the part CSS cannot do: at desk width the sections are **open at once and
 * edited in place**, and at phone width they are collapsed rows that open a
 * sheet. That is a different component tree, not a different set of widths, so
 * something has to decide in JavaScript.
 *
 * `useSyncExternalStore` rather than state-in-an-effect: the width is external
 * to React, the server snapshot is honest about not knowing, and it does not
 * trip the compiler's set-state-in-effect rule.
 */
export type LayoutMode = "compact" | "tablet" | "desk";

/** Both columns fit beside the sections. Matches 19a's 330 + 1fr + 250. */
const DESK = 896;
/** Capture still fits beside the editor; the numbers column folds first. */
const TABLET = 768;

export function useLayoutMode(
  ref: RefObject<HTMLElement | null>
): LayoutMode {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const element = ref.current;
      if (!element || typeof ResizeObserver === "undefined") return () => {};
      const observer = new ResizeObserver(onChange);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [ref]
  );

  const read = useCallback((): LayoutMode => {
    const width = ref.current?.getBoundingClientRect().width ?? 0;
    if (width >= DESK) return "desk";
    if (width >= TABLET) return "tablet";
    return "compact";
  }, [ref]);

  // The server has no width to measure. Rendering the phone frame first and
  // widening after mount is the safe direction: the compact tree is a subset of
  // what the desk tree shows, so nothing flashes information that then vanishes.
  return useSyncExternalStore(subscribe, read, () => "compact" as const);
}
