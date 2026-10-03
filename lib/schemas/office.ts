import { z } from "zod";

import { DOCUMENT_PRESET_IDS } from "@/lib/branding";

/**
 * The Office's write surface — identity, licenses, defaults, packs.
 *
 * Every schema here is a full, explicit patch rather than a partial merge: a
 * form knows what all of its fields are, and a "leave this one alone" that only
 * exists because a field was omitted is how a blank input silently keeps an old
 * value.
 *
 * The exceptions are the license patch, where a partial genuinely means
 * "correct this one field", and the logo, which is uploaded on its own route.
 */

/* ── Business identity ────────────────────────────────────────────────── */

/**
 * What the customer reads at the top of every document.
 *
 * Empty strings are coerced to `null` rather than stored. A phone number the
 * contractor cleared is *absent*, and the difference matters downstream: the
 * projection draws a visible gap for a missing value and would draw an empty
 * line for an empty string.
 */
const blankToNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable();

export const updateOfficeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Your customer sees this at the top of every quote.")
    .max(120, "That's longer than we can store."),
  phone: blankToNull(40),
  email: blankToNull(160).refine(
    (value) => value === null || z.email().safeParse(value).success,
    "Enter a valid email address."
  ),
  /** One field, not a normalised set — there is no Property object here either. */
  address: blankToNull(300),
  website: blankToNull(300),
  /**
   * Optional: the logo is uploaded and removed through `/api/v1/office/logo`,
   * so the identity form leaves it out and leaving it out keeps it.
   */
  logoUrl: blankToNull(2000).optional(),
});

export type UpdateOfficeInput = z.infer<typeof updateOfficeSchema>;
/**
 * What the *form* holds, before the blank-to-null transform runs.
 *
 * React Hook Form binds inputs to the pre-transform shape — an empty text field
 * is `""`, not `null` — so the form is typed on `z.input` and the resolver
 * hands the endpoint the `z.infer` shape on submit.
 */
export type OfficeFormValues = z.input<typeof updateOfficeSchema>;

/* ── Licenses ─────────────────────────────────────────────────────────── */

/**
 * A credential the Office holds.
 *
 * **Jurisdiction and number are the only required fields**, and that is
 * deliberate: they are the two a contractor can read off the card in their
 * wallet. Expiry matters enormously and is still optional, because a license
 * they cannot find the date for should still be recorded rather than blocked —
 * an unrecorded license is worth nothing, and a dated one can be corrected.
 */
export const licenseSchema = z.object({
  /** The shop's own name for it. Optional — plenty of shops hold just one. */
  name: blankToNull(80).optional(),
  jurisdiction: z
    .string()
    .trim()
    .min(1, "Which state, county or township is this good in?")
    .max(120),
  number: z
    .string()
    .trim()
    .min(1, "The number your customer looks for.")
    .max(60),
  class: blankToNull(60),
  holder: blankToNull(120),
  /** ISO dates, as a `date` column takes them. */
  issuedOn: z.iso.date().nullable().optional(),
  expiresOn: z.iso.date().nullable().optional(),
  /** How long before expiry to start reminding. */
  renewalReminderDays: z.number().int().min(0).max(365).nullable().optional(),
});

export type LicenseInput = z.infer<typeof licenseSchema>;
export type LicenseFormValues = z.input<typeof licenseSchema>;

/** Correcting one field on a license — a typo in a number, a new expiry. */
export const updateLicenseSchema = licenseSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change.",
  });

/* ── Document branding ────────────────────────────────────────────────── */

/**
 * How the business looks on a document — Content Design §8's *document
 * branding*, and deliberately not *appearance*.
 *
 * **One field, so it gets its own patch.** The rule everywhere else in this
 * file is that a form sends every field it owns rather than a partial merge;
 * branding owns exactly one, and folding it into the defaults patch would mean
 * the branding page had to echo back a tax rate it never showed anybody.
 */
/** The ids come from `lib/branding`, so the list cannot be renamed here alone. */
export const documentPresetSchema = z.enum(DOCUMENT_PRESET_IDS);

export const updateOfficeBrandingSchema = z.object({
  documentPreset: documentPresetSchema,
});

export type UpdateOfficeBrandingInput = z.infer<
  typeof updateOfficeBrandingSchema
>;

/* ── Defaults ─────────────────────────────────────────────────────────── */

/**
 * Where every new quote begins.
 *
 * **Every field is nullable, and null is a real answer.** A business that has
 * not set a tax rate is not one with a 0% rate — the editor has to be able to
 * tell those apart to know whether to ask — so clearing a field stores `null`
 * rather than a zero.
 *
 * Money arrives as **percentages and dollars the way the form shows them** and
 * is stored the way the database wants it: `taxRate` as the decimal fraction a
 * Quote stores, `laborRateCents` as integer cents. Converting at this boundary
 * is what keeps a rate from being 8.25 in one table and 0.0825 in another.
 */
/**
 * How a job billed in stages is usually split.
 *
 * **Percentages, not amounts** — a pattern has no job behind it. The sum is
 * checked because a draw pattern that does not add up to the whole price is a
 * job that cannot be fully billed, and finding that out on the last draw is the
 * expensive moment.
 */
export const drawPatternSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1, "Name the stage.").max(80),
      percent: z.number().min(0).max(100),
    })
  )
  .max(12)
  .refine(
    (rows) =>
      rows.length === 0 ||
      Math.abs(rows.reduce((sum, row) => sum + row.percent, 0) - 100) < 0.01,
    "The stages have to add up to 100%."
  );

export const updateOfficeDefaultsSchema = z.object({
  depositPercent: z.number().int().min(0).max(100).nullable(),
  materialMarkupPercent: z.number().min(0).max(10_000).nullable(),
  laborRateCents: z.number().int().min(0).nullable(),
  /** Decimal fraction, e.g. 0.0825. */
  taxRate: z.number().min(0).max(1).nullable(),
  quoteValidityDays: z.number().int().min(1).max(365).nullable(),
  drawPattern: drawPatternSchema.nullable(),
  standardExclusions: z.string().max(4000).nullable(),
  standardAssumptions: z.string().max(4000).nullable(),
  standardTerms: z.string().max(8000).nullable(),
  documentPreset: documentPresetSchema.nullable(),
});

export type UpdateOfficeDefaultsInput = z.infer<
  typeof updateOfficeDefaultsSchema
>;

/* ── Trade packs ──────────────────────────────────────────────────────── */

/**
 * Switching a pack on or off.
 *
 * Enablement only — **buying a pack is a Stripe checkout, not a PATCH.**
 * Granting an entitlement from product code would be handing out a paid feature
 * on the client's say-so; entitlements are written by the webhook that saw the
 * money move.
 */
export const updatePackSchema = z.object({
  enabled: z.boolean(),
});

export type UpdatePackInput = z.infer<typeof updatePackSchema>;

/* ── Logo ─────────────────────────────────────────────────────────────── */

/**
 * Where a logo upload is headed. Image types a document can show — no SVG,
 * which can carry script and would be served from a public bucket.
 */
export const logoUploadSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/\.(png|jpe?g|webp)$/i, "Use a PNG, JPG or WebP image."),
});

/** The uploaded file, once it has landed, becomes the Office's logo. */
export const setLogoSchema = z.object({
  path: z.string().trim().min(1).max(400),
});
