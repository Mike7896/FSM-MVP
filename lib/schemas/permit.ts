import { z } from "zod";

/**
 * Permit and inspection validation.
 *
 * A Permit is authorization for one piece of work at one address, consumed by
 * the job and closed when the final inspection passes. It always belongs to a
 * Job, which is why `jobId` is required on create and absent from update — a
 * permit does not move between jobs.
 *
 * Enum values are repeated here rather than imported from the Drizzle schema,
 * matching the other schema files: these stay importable from a client bundle.
 */

export const permitStatusValues = [
  "not_required",
  "needed",
  "applied",
  "issued",
  "inspections_in_progress",
  "closed",
  "expired",
  "rejected",
] as const;

/** All three answers are real — a homeowner-pulled permit is a supported state. */
export const permitPullerValues = [
  "shop",
  "homeowner",
  "subcontractor",
] as const;

export const inspectionTypeValues = [
  "underground",
  "rough_in",
  "service",
  "final",
] as const;

export const inspectionResultValues = [
  "scheduled",
  "passed",
  "failed",
  "cancelled",
] as const;

export const permitStatusSchema = z.enum(permitStatusValues);
export const permitPullerSchema = z.enum(permitPullerValues);
export const inspectionTypeSchema = z.enum(inspectionTypeValues);
export const inspectionResultSchema = z.enum(inspectionResultValues);

/**
 * **Jurisdiction is the only required field besides the job.** It is what a
 * License and a Permit are matched on, and a permit without one cannot be
 * checked against the credential that authorizes it.
 */
export const createPermitSchema = z.object({
  jobId: z.uuid("Which job is this for?"),
  jurisdiction: z.string().trim().min(1, "Which authority?").max(120),
  type: z.string().trim().max(80).optional(),
  /** Absent until the authority issues it — `needed` and `applied` precede it. */
  number: z.string().trim().max(80).optional(),
  scopeCovered: z.string().trim().max(2000).optional(),
  status: permitStatusSchema.default("needed"),
  pulledBy: permitPullerSchema.default("shop"),
  licenseId: z.uuid().optional(),
  /**
   * What the shop actually paid, kept separate from the line item that charged
   * the customer. Conflating them is how a paid permit line ends up with no
   * permit behind it.
   */
  feePaidCents: z.number().int().min(0).optional(),
  appliedOn: z.iso.date().optional(),
  issuedOn: z.iso.date().optional(),
  expiresOn: z.iso.date().optional(),
});

export type CreatePermitInput = z.infer<typeof createPermitSchema>;

export const updatePermitSchema = z
  .object({
    jurisdiction: z.string().trim().min(1).max(120),
    type: z.string().trim().max(80).nullable(),
    number: z.string().trim().max(80).nullable(),
    scopeCovered: z.string().trim().max(2000).nullable(),
    status: permitStatusSchema,
    pulledBy: permitPullerSchema,
    licenseId: z.uuid().nullable(),
    feePaidCents: z.number().int().min(0).nullable(),
    appliedOn: z.iso.date().nullable(),
    issuedOn: z.iso.date().nullable(),
    expiresOn: z.iso.date().nullable(),
    placardUrl: z.string().trim().max(500).nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change.",
  });

/**
 * Scheduling an inspection.
 *
 * `clearsPhase` is load-bearing: a passing rough-in inspection and a completed
 * phase are frequently the same moment, and that is exactly when a contractor
 * is entitled to a draw. Naming the phase here is what lets a passing result be
 * offered as the draw trigger rather than recorded and forgotten.
 */
export const createInspectionSchema = z.object({
  permitId: z.uuid("Which permit is this against?"),
  type: inspectionTypeSchema,
  requestedOn: z.iso.date().optional(),
  scheduledOn: z.iso.date().optional(),
  clearsPhase: z.string().trim().max(120).optional(),
});

export const updateInspectionSchema = z
  .object({
    type: inspectionTypeSchema,
    result: inspectionResultSchema,
    requestedOn: z.iso.date().nullable(),
    scheduledOn: z.iso.date().nullable(),
    completedOn: z.iso.date().nullable(),
    inspectorNotes: z.string().trim().max(4000).nullable(),
    correctionsRequired: z.string().trim().max(4000).nullable(),
    reinspectionFeeCents: z.number().int().min(0).nullable(),
    clearsPhase: z.string().trim().max(120).nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change.",
  });

export const listPermitsSchema = z.object({
  jobId: z.uuid().optional(),
  status: permitStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function validateInspectionResult(value: { result: string; completedOn: string | null; correctionsRequired: string | null }) {
  if (["passed", "failed"].includes(value.result) && !value.completedOn) return "Enter the date the inspection was completed.";
  if (value.result === "failed" && !value.correctionsRequired?.trim()) return "Record the corrections needed after the failed inspection.";
  return null;
}
