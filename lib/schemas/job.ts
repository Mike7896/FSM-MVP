import { tagFilterShape } from "@/lib/tags";
import { z } from "zod";

/** Mirrors the `job_status` enum. Kept in step with lib/db/schema/enums.ts. */
export const jobStatusValues = [
  "quoting",
  "scheduled",
  "in_progress",
  "complete",
  "paid",
] as const;

export const jobStatusSchema = z.enum(jobStatusValues);

/**
 * A Job needs a customer and nothing else.
 *
 * The customer is either one already in the directory (`customerId`) or a
 * typed name for someone who isn't yet (`customerName`) — the same two ways a
 * new quote names its customer, so a job never has to wait on a separate
 * create-the-customer step.
 *
 * No totals here, deliberately: the money state is derived from the job's
 * documents and payments, so there is nothing for a client to send.
 */
export const createJobSchema = z
  .object({
    customerId: z.uuid("Pick a customer.").optional(),
    customerName: z.string().trim().min(1).max(160).optional(),
    name: z.string().trim().max(200).optional(),
    description: z.string().trim().max(4000).optional(),
    address: z.string().trim().max(300).optional(),
    /** Derived from the address by trigger when omitted. */
    jurisdiction: z.string().trim().max(120).optional(),
    packId: z.string().trim().max(60).optional(),
    startsOn: z.iso.date().optional(),
    endsOn: z.iso.date().optional(),
  })
  .refine((body) => body.customerId || body.customerName, {
    message: "Who is the work for?",
    path: ["customerName"],
  });

export type CreateJobInput = z.infer<typeof createJobSchema>;

export const updateJobSchema = z
  .object({
    name: z.string().trim().max(200).nullable(),
    description: z.string().trim().max(4000).nullable(),
    address: z.string().trim().max(300).nullable(),
    jurisdiction: z.string().trim().max(120).nullable(),
    status: jobStatusSchema,
    startsOn: z.iso.date().nullable(),
    endsOn: z.iso.date().nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change.",
  });

export const listJobsSchema = z.object({
  ...tagFilterShape,
  status: jobStatusSchema.optional(),
  customerId: z.uuid().optional(),
  /** Matches customer name, the work, or the address. */
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
