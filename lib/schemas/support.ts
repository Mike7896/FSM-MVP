import { z } from "zod";

/** `POST /api/v1/support` — a problem, an idea, or a request for help. */
export const createSupportRequestSchema = z.object({
  kind: z.enum(["bug", "idea", "help"]),
  subject: z
    .string()
    .trim()
    .min(1, "Say what it's about in a line.")
    .max(140, "Keep the first line under 140 characters — the rest goes below."),
  body: z
    .string()
    .trim()
    .min(1, "Tell us a little more.")
    .max(5000, "That's longer than we can take in one go — 5,000 characters at most."),
  /** The page they were on, as a path. Never a full URL with somebody's query string. */
  page: z
    .string()
    .max(300)
    .regex(/^\/[\w\-/.]*$/, "A page is a path in the app.")
    .nullable()
    .optional(),
});

export type CreateSupportRequestInput = z.infer<typeof createSupportRequestSchema>;

/** `PATCH /api/v1/support/[id]` — the Sentry event the browser filed it as. */
export const linkSupportRequestSchema = z.object({
  sentryEventId: z.string().regex(/^[0-9a-f]{32}$/i, "That isn't a Sentry event id."),
});
