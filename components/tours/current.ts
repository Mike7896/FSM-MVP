"use client";

import { useContext } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { TourContext, type TourSession } from "@/components/tours/context";
import {
  TOURS,
  findTour,
  resumeAt,
  type TourId,
  type TourProgress,
  type TourStep,
} from "@/lib/tours";

export type CurrentTour = { tourId: TourId; stepId: string };

/**
 * Which tour is open and where — one started by a button; else one asked for
 * with `?tour=<id>`; else one whose route this is and that hasn't been
 * finished or skipped. The tour host draws it; a screen that has to open a
 * panel for a step reads it through `useTourStep`.
 */
export function resolveCurrentTour(
  session: TourSession,
  progress: Partial<Record<TourId, TourProgress>>,
  pathname: string,
  requested: string | null
): CurrentTour | null {
  if (session.state === "running") {
    return { tourId: session.tourId, stepId: session.stepId };
  }
  if (session.state === "closed") return null;

  const asked = requested ? findTour(requested) : null;
  if (asked) {
    return { tourId: asked.id, stepId: resumeAt(asked, progress[asked.id]) };
  }

  for (const tour of Object.values(TOURS)) {
    if (tour.trigger.type !== "route" || tour.trigger.pathname !== pathname) {
      continue;
    }
    const saved = progress[tour.id];
    if (!saved || saved.status === "in_progress") {
      return { tourId: tour.id, stepId: resumeAt(tour, saved) };
    }
  }

  return null;
}

/**
 * The step a tour is on, for screens that need to show its part — open a tab,
 * unfold a panel. Null outside a tour, and outside the signed-in layouts where
 * there is no tour system at all.
 */
export function useTourStep(): TourStep | null {
  const tours = useContext(TourContext);
  const pathname = usePathname();
  const requested = useSearchParams().get("tour");
  if (!tours) return null;

  const current = resolveCurrentTour(
    tours.session,
    tours.progress,
    pathname,
    requested
  );
  if (!current) return null;
  return (
    TOURS[current.tourId].steps.find((step) => step.id === current.stepId) ??
    null
  );
}
