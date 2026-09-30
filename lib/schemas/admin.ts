import { z } from "zod";

/** The admin panel's account API. */

const day = z.iso.date();

export const createTestAccountSchema = z.object({
  email: z.email("That doesn't look like an email address.").max(200),
  fullName: z.string().trim().max(120).nullable().optional().default(null),
  /** Left out, one is made for them and shown once. */
  password: z
    .string()
    .min(10, "Make it at least 10 characters — or leave it blank and one is made for you.")
    .max(72)
    .nullable()
    .optional()
    .default(null),
  accessUntil: day.nullable().optional().default(null),
  dailySendLimit: z.number().int().min(0).max(1000).nullable().optional().default(null),
  compPlan: z.boolean().optional().default(true),
  note: z.string().trim().max(500).nullable().optional().default(null),
});

export const inviteAccountSchema = z.object({
  email: z.email("That doesn't look like an email address.").max(200),
  fullName: z.string().trim().max(120).nullable().optional().default(null),
  /** Founding prices when they subscribe, open offer or not. */
  founding: z.boolean().optional().default(false),
  /** Pro, free through this day. Null: no free period. */
  freeUntil: day.nullable().optional().default(null),
  /** A line from you, at the top of the email. */
  message: z.string().trim().max(1000).nullable().optional().default(null),
  /** Off: make the account and hand back the link to send yourself. */
  send: z.boolean().optional().default(true),
});

export const resendInviteSchema = z.object({ send: z.boolean().optional().default(true) });

export const updateAccountPolicySchema = z
  .object({
    kind: z.enum(["standard", "tester"]),
    compPlan: z.boolean(),
    accessUntil: day.nullable(),
    dailySendLimit: z.number().int().min(0).max(1000).nullable(),
    note: z.string().trim().max(500).nullable(),
    /** Founding pricing (§6), kept on the sign-in account rather than the policy row. */
    foundingMember: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Send at least one thing to change." });

export const setAdminSchema = z.object({ on: z.boolean() });

export const suspendSchema = z.object({
  reason: z.string().trim().min(3, "Say why, in a few words — it's kept with the suspension.").max(300),
});

export const listAccountsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(["all", "admins", "testers", "invited", "suspended"]).optional(),
});
