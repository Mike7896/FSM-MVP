import { tagFilterShape } from "@/lib/tags";
import { z } from "zod";

/**
 * Customer is deliberately thin — a directory for finding jobs by person.
 * Only the name is required, because a contractor entering someone at the
 * kitchen table has a name and often nothing else yet.
 */
export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, "Who is this for?").max(160),
  email: z.email("Enter a valid email address.").optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/**
 * Editing one. Every field is optional; a contractor who learns a phone number
 * three weeks in is patching one field, not resubmitting a person.
 */
export const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(1, "Who is this?").max(160),
    email: z.email("Enter a valid email address.").nullable().or(z.literal("")),
    phone: z.string().trim().max(40).nullable(),
    address: z.string().trim().max(300).nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change.",
  });

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const listCustomersSchema = z.object({
  ...tagFilterShape,
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
