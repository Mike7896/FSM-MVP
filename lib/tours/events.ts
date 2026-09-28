import type { TourEvent } from "./types";

/**
 * How a screen tells the tour system that something happened.
 *
 * A screen calls `emitTourEvent("quote.price-entered")` at the moment it
 * happens and carries on; whether any tour is waiting for it is not the
 * screen's concern. Module-level rather than React context, so a call site deep
 * in a tree — a row, a picker — needs nothing threaded to it, and an emit with
 * nobody listening costs nothing.
 */
type Listener = (event: TourEvent) => void;

const listeners = new Set<Listener>();

export function emitTourEvent(event: TourEvent) {
  for (const listener of listeners) listener(event);
}

export function onTourEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
