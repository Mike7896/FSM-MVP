import { z } from "zod";

import { NOTIFICATION_KIND_IDS } from "@/lib/notifications/catalog";
import { toE164 } from "@/lib/sms/phone";

/**
 * `PATCH /api/v1/notifications/preferences` — one event's channels, for the
 * person signed in. Any one channel alone is a complete change.
 */
export const updateNotificationPreferenceSchema = z
  .object({
    kind: z.enum(NOTIFICATION_KIND_IDS),
    push: z.boolean().optional(),
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
  })
  .refine(
    (change) =>
      change.push !== undefined ||
      change.email !== undefined ||
      change.sms !== undefined,
    {
      message: "Say which channel to change — push, email, text, or more than one.",
      path: ["email"],
    }
  );

export type UpdateNotificationPreferenceInput = z.infer<
  typeof updateNotificationPreferenceSchema
>;

const hour = z.number().int().min(0).max(23);

/**
 * `PATCH /api/v1/notifications/settings` — how the person signed in is
 * reached. Any subset; what isn't sent keeps its value.
 *
 * The number is stored as E.164 whatever shape it was typed in, and blank
 * clears it. A time zone has to be one this runtime knows, or quiet hours
 * would be measured against a clock that doesn't exist.
 */
export const notificationSettingsSchema = z
  .object({
    emailFrequency: z.enum(["instant", "daily"]),
    digestHour: hour,
    smsPhone: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .transform((value, ctx) => {
        if (!value) return null;
        const e164 = toE164(value);
        if (!e164) {
          ctx.addIssue({
            code: "custom",
            message: "That doesn't look like a mobile number. Include the area code.",
          });
          return z.NEVER;
        }
        return e164;
      }),
    quietHours: z.boolean(),
    quietStart: hour,
    quietEnd: hour,
    timeZone: z
      .string()
      .max(64)
      .nullable()
      .refine((zone) => zone === null || knownZone(zone), {
        message: "That time zone isn't one we recognise.",
      }),
    toasts: z.boolean(),
  })
  .partial();

export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;

/** `POST /api/v1/notifications/read` — some, or all. */
export const markNotificationsReadSchema = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(100) }),
  z.object({ all: z.literal(true) }),
]);

/** `GET /api/v1/notifications` — optionally only what's newer than a moment. */
export const listNotificationsSchema = z.object({
  after: z.iso.datetime({ offset: true }).optional(),
});

function knownZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
