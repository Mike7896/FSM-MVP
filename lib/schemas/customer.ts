import { tagFilterShape } from "@/lib/tags";
import { z } from "zod";

/**
 * A customer's details, as the form and the API take them.
 *
 * Nothing is required but a name — a person's or a company's — because a
 * contractor entering someone at the kitchen table has a name and often
 * nothing else yet. Blank strings are how a form clears a field; the routes
 * store them as null.
 */

const text = (max: number) => z.string().trim().max(max);
const email = z.email("Enter a valid email address.").or(z.literal(""));

export const CONTACT_METHODS = ["call", "text", "email"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

const detailFields = {
  firstName: text(80),
  lastName: text(80),
  companyName: text(160),
  email,
  altEmail: email,
  phone: text(40),
  altPhone: text(40),
  preferredContact: z.enum(CONTACT_METHODS).or(z.literal("")),
  address: text(300),
  billingAddress: text(300),
  accessNotes: text(1000),
  leadSource: text(80),
};

const NEEDS_A_NAME = "Enter a first name, a last name or a company.";

function named(body: {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}) {
  return Boolean(
    body.name?.trim() ||
      body.firstName?.trim() ||
      body.lastName?.trim() ||
      body.companyName?.trim()
  );
}

/**
 * The customer form on the web — every field a string, so an empty input is
 * "" rather than undefined.
 */
export const customerFormSchema = z
  .object(detailFields)
  .refine(named, { message: NEEDS_A_NAME, path: ["firstName"] });

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

/**
 * Adding one. `name` is still taken whole, for clients that only have a single
 * box — it is split into first and last on the way in. `notes` becomes the
 * first entry in their notes log.
 */
export const createCustomerSchema = z
  .object({
    name: text(160),
    ...detailFields,
    notes: text(2000),
  })
  .partial()
  .refine(named, { message: NEEDS_A_NAME, path: ["firstName"] });

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/**
 * Editing one. Every field is optional; a contractor who learns a phone number
 * three weeks in is patching one field, not resubmitting a person. Null or ""
 * clears a field.
 */
export const updateCustomerSchema = z
  .object({
    name: text(160).nullable(),
    firstName: detailFields.firstName.nullable(),
    lastName: detailFields.lastName.nullable(),
    companyName: detailFields.companyName.nullable(),
    email: email.nullable(),
    altEmail: email.nullable(),
    phone: detailFields.phone.nullable(),
    altPhone: detailFields.altPhone.nullable(),
    preferredContact: detailFields.preferredContact.nullable(),
    address: detailFields.address.nullable(),
    billingAddress: detailFields.billingAddress.nullable(),
    accessNotes: detailFields.accessNotes.nullable(),
    leadSource: detailFields.leadSource.nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change.",
  });

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

/** One note in a customer's log. */
export const customerNoteSchema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(2000),
});

export const listCustomersSchema = z.object({
  ...tagFilterShape,
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
