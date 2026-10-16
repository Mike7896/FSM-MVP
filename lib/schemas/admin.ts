import { z } from "zod";

/** The admin panel's account API. */

const day = z.iso.date();

/** How long the note at the top of an invite email can be — about a page. */
export const INVITE_NOTE_MAX = 5000;
const inviteNote = z
  .string()
  .trim()
  .max(INVITE_NOTE_MAX, `Keep the note under ${INVITE_NOTE_MAX.toLocaleString("en-US")} characters.`);

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
  /** A note from you, at the top of the email. */
  message: inviteNote.nullable().optional().default(null),
  /** Off: make the account and hand back the link to send yourself. */
  send: z.boolean().optional().default(true),
});

export const resendInviteSchema = z.object({
  send: z.boolean().optional().default(true),
  /** A corrected address, while they haven't signed in. Left out: the same one. */
  email: z.email("That doesn't look like an email address.").max(200).optional(),
  /** A new note for the email. Left out: the one sent before; null: none. */
  message: inviteNote.nullable().optional(),
});

export const updateAccountPolicySchema = z
  .object({
    kind: z.enum(["standard", "tester"]),
    compPlan: z.boolean(),
    accessUntil: day.nullable(),
    dailySendLimit: z.number().int().min(0).max(1000).nullable(),
    note: z.string().trim().max(500).nullable(),
    /** One of ours: never counted on the admin dashboard. */
    internal: z.boolean(),
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
  filter: z.enum(["all", "admins", "testers", "internal", "invited", "suspended"]).optional(),
});
