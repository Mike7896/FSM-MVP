"use client";

import {
  Suspense,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  TourContext,
  saveTourProgress,
  type TourSession,
  type Tours,
} from "@/components/tours/context";
import { TourHost } from "@/components/tours/tour-host";
import {
  findTour,
  resumeAt,
  type TourId,
  type TourProgress,
  type TourStatus,
} from "@/lib/tours";

/**
 * The tour system's runtime — one in each signed-in layout.
 *
 * Seeded with this person's progress from the server, so the first render
 * already knows what they've finished and nothing flashes open and shut while
 * a fetch catches up. It holds which tour is running and records every move;
 * `TourHost`, mounted here once, draws the current step on whatever screen is
 * showing.
 */
export function TourProvider({
  initialProgress,
  children,
}: {
  initialProgress: TourProgress[];
  children: ReactNode;
}) {
  const [progress, setProgress] = useState<
    Partial<Record<TourId, TourProgress>>
  >(() =>
    Object.fromEntries(initialProgress.map((entry) => [entry.tourId, entry]))
  );
  const [session, setSession] = useState<TourSession>({ state: "idle" });

  const record = useCallback(
    (tourId: TourId, status: TourStatus, stepId: string | null) => {
      setProgress((current) => ({
        ...current,
        [tourId]: {
          tourId,
          status,
          stepId,
          updatedAt: new Date().toISOString(),
        },
      }));
      saveTourProgress(tourId, status, stepId);
    },
    []
  );

  const goTo = useCallback(
    (tourId: TourId, stepId: string) => {
      setSession({ state: "running", tourId, stepId });
      record(tourId, "in_progress", stepId);
    },
    [record]
  );

  const start = useCallback(
    (tourId: TourId) => {
      const tour = findTour(tourId);
      if (tour) goTo(tour.id, tour.steps[0].id);
    },
    [goTo]
  );

  const resume = useCallback(
    (tourId: TourId) => {
      const tour = findTour(tourId);
      if (tour) goTo(tour.id, resumeAt(tour, progress[tour.id]));
    },
    [goTo, progress]
  );

  const skip = useCallback(
    (tourId: TourId, stepId: string | null) => {
      setSession({ state: "closed" });
      record(tourId, "skipped", stepId);
    },
    [record]
  );

  const complete = useCallback(
    (tourId: TourId) => {
      setSession({ state: "closed" });
      record(tourId, "completed", null);
    },
    [record]
  );

  const value = useMemo<Tours>(
    () => ({ progress, session, start, resume, goTo, skip, complete }),
    [progress, session, start, resume, goTo, skip, complete]
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {/* Suspense because the host reads `?tour=` from the URL. */}
      <Suspense fallback={null}>
        <TourHost />
      </Suspense>
    </TourContext.Provider>
  );
}
