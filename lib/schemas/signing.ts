import { z } from "zod";

/** A signature is a typed name or drawn strokes — never both. */
export const signatureMarkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("typed") }),
  z.object({
    kind: z.literal("drawn"),
    paths: z.array(z.string()).min(1).max(200),
  }),
]);

/**
 * `PUT /api/v1/office/signature` — the business adopts the signature its
 * contracts carry from the moment a customer approves.
 */
export const storedSignatureSchema = z.object({
  printedName: z
    .string()
    .trim()
    .min(1, "Type the name that goes under your signature.")
    .max(120),
  mark: signatureMarkSchema,
  autoSign: z.boolean(),
});

export type StoredSignatureInput = z.infer<typeof storedSignatureSchema>;

/** `PATCH /api/v1/office/signature` — whether new contracts are signed as they're created. */
export const autoSignSchema = z.object({ autoSign: z.boolean() });
