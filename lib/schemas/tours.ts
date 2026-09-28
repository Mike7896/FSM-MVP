import { z } from "zod";

/** `PUT /api/v1/tours/[tourId]` — where this person is in one tour. */
export const updateTourProgressSchema = z.object({
  status: z.enum(["in_progress", "completed", "skipped"]),
  stepId: z.string().trim().min(1).max(80).nullable(),
});

export type UpdateTourProgressInput = z.infer<typeof updateTourProgressSchema>;
