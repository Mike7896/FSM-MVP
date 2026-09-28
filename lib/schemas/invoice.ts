import { z } from "zod";

/**
 * Invoice validation, shared by the client and the endpoint.
 *
 * **One object, three moments.** A deposit is an Invoice issued at signing, a
 * draw is one released against a met gate with evidence attached, and a final
 * balance is one at completion. `type` is which moment this is — not three
 * different documents.
 *
 * Enum values are repeated here rather than imported from the Drizzle schema,
 * matching `job.ts` and `quote.ts`: these files stay importable from a client
 * bundle, and they are checked against `lib/db/schema/enums.ts` when either
 * changes.
 */

export const invoiceTypeValues = ["deposit", "draw", "final_balance"] as const;

/**
 * An invoice's closed status set — `lib/documents/lifecycle.ts`. `overdue` is
 * not one of them: it is derived from the due date at read time, never stored.
 */
export const invoiceStatusValues = [
  "draft",
  "issued",
  "sent",
  "viewed",
  "paid",
  "void",
] as const;

export const invoiceTypeSchema = z.enum(invoiceTypeValues);
export const invoiceStatusSchema = z.enum(invoiceStatusValues);

/**
 * Creating one.
 *
 * `sourceContractId` is optional because a standalone invoice is legitimate —
 * a contractor invoices work that was agreed on the phone. But when it *is*
 * present it must be the contract on this job, which the route checks: billing
 * against another job's agreement is how money ends up on the wrong ledger.
 *
 * **Money is integer cents**, and `.int()` is doing real work rather than being
 * decorative — a float here is an invoice that does not reconcile.
 */
export const createInvoiceSchema = z.object({
  jobId: z.uuid("Which job is this for?"),
  type: invoiceTypeSchema,
  amountDueCents: z.number().int().min(0),
  /** What this bill covers, in the customer's words. */
  covers: z.string().trim().max(2000).optional(),
  sourceContractId: z.uuid().optional(),
  sourceChangeOrderId: z.uuid().optional(),
  /** Evidence this draw is released against. */
  evidenceId: z.uuid().optional(),
  /**
   * The planned phase this bills. The phase becomes this invoice, and its
   * latest proof rides along when `evidenceId` isn't given.
   */
  drawScheduleId: z.uuid().optional(),
  dueOn: z.iso.date().optional(),
  /** Issue it immediately rather than leaving it a draft. */
  issue: z.boolean().default(false),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z
  .object({
    amountDueCents: z.number().int().min(0),
    covers: z.string().trim().max(2000).nullable(),
    dueOn: z.iso.date().nullable(),
    /**
     * Issue a draft. Every later status — sent, opened, paid — is something
     * that happens to an invoice, not a field anyone sets.
     */
    issue: z.literal(true),
    gateMet: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change.",
  });

export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

/**
 * `POST /api/v1/invoices/[id]/send` — the bill goes out.
 *
 * The same two ways as a quote: through the product by email, or as a link he
 * pastes into the texts he already sends. The link is never optional — it is
 * how she pays.
 */
export const sendInvoiceSchema = z.object({
  channel: z.enum(["email", "link"]),
  to: z.email("Enter a valid email address.").optional(),
  message: z.string().trim().max(2000).optional(),
});

export type SendInvoiceInput = z.infer<typeof sendInvoiceSchema>;

export const listInvoicesSchema = z.object({
  jobId: z.uuid().optional(),
  status: invoiceStatusSchema.optional(),
  type: invoiceTypeSchema.optional(),
  /** Past due and not settled — what the dashboard's chase list is built from. */
  overdue: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
