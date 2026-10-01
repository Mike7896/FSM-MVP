import { z } from "zod";

/**
 * `POST /api/v1/contracts/[id]/send` — a copy goes to the customer.
 *
 * The same two ways out as a quote or a bill: through the product by email, or
 * as a link the contractor pastes into the text he was going to send anyway.
 * The link is never optional — it is where the contract is read and signed.
 */
export const sendContractSchema = z.object({
  channel: z.enum(["email", "link"]),
  to: z.email("Enter a valid email address.").optional(),
  message: z.string().trim().max(2000).optional(),
});

export type SendContractInput = z.infer<typeof sendContractSchema>;
