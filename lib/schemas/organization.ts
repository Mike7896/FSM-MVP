import { z } from "zod";

/**
 * The Office. Created at the letterhead during activation, when a contractor
 * skips straight to the dashboard, or from `/office`.
 */
export const createOrganizationSchema = z.object({
  /**
   * Optional, because the Office can exist before it has a name. A contractor
   * who skips to the dashboard needs somewhere for his work to live, and the
   * name is asked for at the letterhead, where his customer would see it.
   */
  name: z
    .string()
    .trim()
    .max(120, "That's longer than we can store.")
    .optional(),
  /** URL-safe handle. Generated from the name when omitted. */
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only.")
    .optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.email("Enter a valid email address.").optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
