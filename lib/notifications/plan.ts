import type { NotificationSettings } from "./catalog";
import { inQuietHours, nextLocalHour } from "./clock";

/**
 * Which deliveries one event queues, and when each is due — decided in one
 * pure function so the rules can be checked without a database.
 *
 * - **Email** goes now, or is held for the person's daily summary at their
 *   hour.
 * - **A text** needs a number to go to; inside quiet hours it waits for the
 *   end of them rather than waking anyone. Email never waits — it sits in an
 *   inbox anyway.
 * - Nothing else is decided here: whether an event is wanted on a channel at
 *   all is the preferences' answer, passed in.
 */
export type PlannedDelivery = {
  notificationId: string;
  channel: "email" | "sms";
  digest: boolean;
  nextAttemptAt: Date;
};

export function planDeliveries({
  written,
  wantsEmail,
  wantsText,
  settings,
  now,
}: {
  written: { id: string; userId: string }[];
  wantsEmail: Set<string>;
  wantsText: Set<string>;
  settings: Map<string, NotificationSettings>;
  now: Date;
}): PlannedDelivery[] {
  const planned: PlannedDelivery[] = [];

  for (const row of written) {
    const mine = settings.get(row.userId);
    if (!mine) continue;

    if (wantsEmail.has(row.userId)) {
      const daily = mine.emailFrequency === "daily";
      planned.push({
        notificationId: row.id,
        channel: "email",
        digest: daily,
        nextAttemptAt: daily ? nextLocalHour(now, mine.timeZone, mine.digestHour) : now,
      });
    }

    if (wantsText.has(row.userId) && mine.smsPhone) {
      const quiet =
        mine.quietHours &&
        inQuietHours(now, mine.timeZone, mine.quietStart, mine.quietEnd);
      planned.push({
        notificationId: row.id,
        channel: "sms",
        digest: false,
        nextAttemptAt: quiet ? nextLocalHour(now, mine.timeZone, mine.quietEnd) : now,
      });
    }
  }

  return planned;
}
