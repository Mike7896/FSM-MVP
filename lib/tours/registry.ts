import { onboardingTour } from "./onboarding";
import type { TourDefinition, TourId, TourProgress } from "./types";

/**
 * Every tour, by id — the one list anything that shows tours reads: the host
 * deciding what to open, the API validating a progress write, the dashboard
 * offering to resume, and later a Learn page listing lessons.
 */
export const TOURS: Record<TourId, TourDefinition> = {
  onboarding: onboardingTour,
};

export function findTour(id: string): TourDefinition | null {
  return (TOURS as Record<string, TourDefinition>)[id] ?? null;
}

/**
 * The step to open a tour at: where this person stopped, unless they finished
 * it or that step no longer exists — then the top.
 */
export function resumeAt(
  tour: TourDefinition,
  saved: TourProgress | undefined
): string {
  const stepId = saved && saved.status !== "completed" ? saved.stepId : null;
  return stepId && tour.steps.some((step) => step.id === stepId)
    ? stepId
    : tour.steps[0].id;
}
