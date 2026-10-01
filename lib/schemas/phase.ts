import { z } from "zod";

/**
 * A job's phases — how its money is planned to come in, stage by stage — and
 * the proof recorded when one is done.
 *
 * Enum values are repeated here rather than imported from the Drizzle schema,
 * matching `invoice.ts`: these files stay importable from a client bundle, and
 * they are checked against `lib/db/schema/enums.ts` when either changes.
 */

export const phaseGateValues = [
  "on_acceptance",
  "phase_complete",
  "inspection_passed",
  "on_completion",
] as const;

export const phaseGateSchema = z.enum(phaseGateValues);

export type PhaseGate = z.infer<typeof phaseGateSchema>;

/** `PUT /api/v1/jobs/[id]/phases` — the whole plan, in order. */
export const planPhasesSchema = z.object({
  phases: z
    .array(
      z.object({
        /** Present for a phase that already exists; absent for a new one. */
        id: z.uuid().optional(),
        name: z
          .string()
          .trim()
          .min(1, "Name the phase.")
          .max(80, "Keep the name short — it's a label on the bill."),
        amountCents: z.number().int().min(0),
        gate: phaseGateSchema,
      })
    )
    .max(12, "Twelve phases is the most one job can have."),
});

export type PlanPhasesInput = z.infer<typeof planPhasesSchema>;

/** `POST /api/v1/jobs/[id]/phases/[phaseId]/evidence` — marking one complete. */
export const recordEvidenceSchema = z.object({
  summary: z
    .string()
    .trim()
    .min(1, "Say what was done — your customer reads this before the bill.")
    .max(2000, "That's longer than we can store."),
  /** Photos from this job's captures, in the order they were picked. */
  captureIds: z
    .array(z.uuid())
    .max(24, "Twenty-four photos is the most one phase can carry."),
});

export type RecordEvidenceInput = z.infer<typeof recordEvidenceSchema>;
