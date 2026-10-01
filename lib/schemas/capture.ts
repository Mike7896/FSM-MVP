import { z } from "zod";

/**
 * Capture artifacts — what was recorded while walking the job.
 *
 * **Capture exists as its own object because the walkthrough happens before the
 * quote does.** Forcing it into the quote would mean nothing can be recorded
 * until pricing has started, which is backwards from how a walkthrough actually
 * goes. So a capture belongs to a Job and nothing else, and it is created
 * without any document existing.
 *
 * The same shape serves two sources that feel different and are not: what the
 * contractor photographed on site, and what a customer sent in with an enquiry.
 * An inbound request creates the Job — the model's rule is that the Job is the
 * only prerequisite anywhere and is created silently by whichever thing comes
 * first — and her photos land as captures on it. The panel beside the editor
 * cannot tell the two apart, and should not.
 */

export const captureKindValues = [
  "note",
  "photo",
  "measurement",
  "audio",
] as const;

export const captureKindSchema = z.enum(captureKindValues);

/**
 * Asking for somewhere to put a file.
 *
 * The browser uploads **straight to Storage** with a short-lived signed URL
 * rather than posting the bytes through this app. A walkthrough's photographs
 * are tens of megabytes and routing them through a Next server buys nothing but
 * a timeout — and the bucket's own RLS, keyed on the organization in the first
 * path segment, is the same check either way.
 */
export const captureUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
});

/**
 * Recording what was captured.
 *
 * `storagePath` is set **after** the upload succeeds, which is why this is a
 * separate call from the one above: a row written before the bytes land is a
 * thumbnail that never loads, and the panel is a record of a walkthrough rather
 * than a list of intentions.
 */
export const createCaptureSchema = z
  .object({
    kind: captureKindSchema,
    /** Note text, a measurement, or a caption on a photograph. */
    body: z.string().trim().max(4000).nullable().optional(),
    /** The object path returned by the upload call. Absent on a plain note. */
    storagePath: z.string().trim().max(500).nullable().optional(),
    /** Set with one tap on site — "for insurance", "before". */
    flag: z.string().trim().max(60).nullable().optional(),
    capturedAt: z.iso.datetime().optional(),
  })
  .refine((body) => body.kind === "photo" || body.kind === "audio" || !!body.body, {
    message: "A note or a measurement needs something written in it.",
    path: ["body"],
  })
  .refine((body) => (body.kind === "photo" ? !!body.storagePath : true), {
    message: "A photo needs a file behind it.",
    path: ["storagePath"],
  });

export type CreateCaptureInput = z.infer<typeof createCaptureSchema>;
