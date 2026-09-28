"use client";

import { createContext, useContext } from "react";

import type { TourId, TourProgress, TourStatus } from "@/lib/tours";

/**
 * What a signed-in screen can ask of the tour system.
 *
 * Split from the provider so the host and the buttons that start tours import
 * this, and not each other.
 */

export type TourSession =
  /** Nothing chosen yet — the host may open a tour by route or by link. */
  | { state: "idle" }
  | { state: "running"; tourId: TourId; stepId: string }
  /** Finished or skipped in this visit; nothing opens by itself again. */
  | { state: "closed" };

export type Tours = {
  progress: Partial<Record<TourId, TourProgress>>;
  session: TourSession;
  /** From the first step — "Show me around". */
  start: (tourId: TourId) => void;
  /** From where this person stopped — "Resume tour". */
  resume: (tourId: TourId) => void;
  /** Move to a step, recording it so the tour resumes there. */
  goTo: (tourId: TourId, stepId: string) => void;
  /** Stop, keeping the step so it can be resumed. */
  skip: (tourId: TourId, stepId: string | null) => void;
  complete: (tourId: TourId) => void;
};

export const TourContext = createContext<Tours | null>(null);

export function useTours(): Tours {
  const tours = useContext(TourContext);
  if (!tours) {
    throw new Error(
      "useTours needs a <TourProvider> above it — it lives in the signed-in layouts."
    );
  }
  return tours;
}

/**
 * Writes where this person is. Fire and forget: a step on screen never waits
 * on the network, and `keepalive` lets the write land when the click that
 * caused it also navigates away. Losing one write costs a resume point, not
 * the tour.
 */
export function saveTourProgress(
  tourId: TourId,
  status: TourStatus,
  stepId: string | null
) {
  void fetch(`/api/v1/tours/${tourId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, stepId }),
    keepalive: true,
  }).catch(() => {});
}
