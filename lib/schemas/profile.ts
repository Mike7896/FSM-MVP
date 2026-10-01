import { z } from "zod";

import { TRADE_IDS } from "@/lib/trades";

/**
 * The signed-in person's own small facts — `PATCH /api/v1/profile`.
 *
 * Partial on purpose: each field is written by a different moment in the
 * product — the trade question, the one-time teach beat, the post-send offers —
 * and none of those moments knows about the others.
 */
export const updateProfileSchema = z
  .object({
    trade: z.enum(TRADE_IDS),
    /** The "this is a job now" beat has been shown. It never comes back. */
    teachSeen: z.literal(true),
    /** The post-send offers were dismissed as a group. They never come back. */
    offersDismissed: z.literal(true),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change.",
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
