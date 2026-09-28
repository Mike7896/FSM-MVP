import { z } from "zod";

/**
 * A membership configuration, as a client may ask for one (Billing §5.2).
 *
 * Tier, interval and packs — never a Stripe price id. Which price that means
 * (public or founding) is the server's decision.
 */
export const membershipConfigSchema = z.object({
  tier: z.enum(["starter", "pro"]),
  interval: z.enum(["month", "year"]),
  packs: z.array(z.enum(["electrical"])).max(1).default([]),
});

export type MembershipConfigInput = z.infer<typeof membershipConfigSchema>;

export const membershipCheckoutSchema = membershipConfigSchema.extend({
  /** An in-app path to land on afterwards — the draft that hit the limit. */
  returnPath: z
    .string()
    .regex(/^\/(?!\/)[\w\-/?=&%.]*$/, "An in-app path.")
    .max(300)
    .optional(),
});

export const membershipChangeSchema = membershipConfigSchema.extend({
  /** The proration moment from the preview the person confirmed. */
  prorationDate: z.number().int().positive(),
});

export const jobActivationSchema = z.object({
  action: z.literal("pdf"),
});
