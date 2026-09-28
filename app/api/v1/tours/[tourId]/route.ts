import { requireCaller } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { saveTourProgress } from "@/lib/queries/tours";
import { updateTourProgressSchema } from "@/lib/schemas";
import { findTour } from "@/lib/tours";

/**
 * `PUT /api/v1/tours/[tourId]` — record where the caller is in one tour.
 *
 * Refuses a tour or step the registry doesn't know, so a stale client can't
 * park someone on a step that no longer exists and leave "Resume tour" pointing
 * at nothing.
 */
export const PUT = handlerWithParams<{ tourId: string }>(
  async (request, { tourId }) => {
    const caller = await requireCaller(request);

    const tour = findTour(tourId);
    if (!tour) throw new ApiError("not_found", "There's no tour with that id.");

    const body = await readJson(request, updateTourProgressSchema);

    if (
      body.stepId !== null &&
      !tour.steps.some((step) => step.id === body.stepId)
    ) {
      throw new ApiError(
        "invalid_request",
        "That step isn't part of this tour.",
        [{ field: "stepId", message: "That step isn't part of this tour." }]
      );
    }

    return ok(
      await saveTourProgress(caller.userId, tour.id, body.status, body.stepId)
    );
  }
);
