import { z } from "zod";

import { signatureMarkSchema } from "./signing";

/**
 * `POST /api/share/[token]/sign` — the customer signs from the link.
 *
 * A name, a mark and the consent box, and nothing else: who they are is the
 * token, and when and from where are read off the request. A client that could
 * send its own IP or signing time could forge the audit trail.
 */
export const signFromLinkSchema = z.object({
  printedName: z.string().trim().min(1).max(120),
  consented: z.boolean(),
  mark: signatureMarkSchema,
});

export type SignFromLinkInput = z.infer<typeof signFromLinkSchema>;
