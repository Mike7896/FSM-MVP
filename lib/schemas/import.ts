import { z } from "zod";

import { MAX_IMPORT_ROWS } from "@/lib/import/csv";

/**
 * Bringing a spreadsheet in — read it first, write it second.
 *
 * Two bodies because it is two acts: the preview says what *would* happen and
 * writes nothing, and the import carries back only the rows the contractor
 * confirmed. Sending the file again on the second call would risk importing
 * something other than what they reviewed.
 */

/** Two megabytes of text is a very large customer list and a small upload. */
export const previewImportSchema = z.object({
  csv: z.string().min(1, "Pick a file first.").max(2_000_000, "That file is too big."),
});

export type PreviewImportInput = z.infer<typeof previewImportSchema>;

const importedCustomer = z.object({
  name: z.string().trim().min(1, "Who is this?").max(160),
  email: z.string().trim().max(160).nullish(),
  phone: z.string().trim().max(40).nullish(),
  address: z.string().trim().max(300).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const importCustomersSchema = z.object({
  rows: z
    .array(importedCustomer)
    .min(1, "Nothing was selected to bring in.")
    .max(MAX_IMPORT_ROWS),
});

export type ImportCustomersInput = z.infer<typeof importCustomersSchema>;
