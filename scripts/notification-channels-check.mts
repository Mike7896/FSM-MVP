/**
 * How a notification is delivered — the rules, checked without a database.
 *
 * - **Email** goes now, or waits for the person's daily summary at their hour
 *   on their own clock.
 * - **A text** needs a number, and inside quiet hours waits for them to end —
 *   including quiet hours that cross midnight, and people in other time zones.
 * - **Email never waits for quiet hours.**
 * - Numbers are stored as E.164 whatever shape they were typed in, and a
 *   settings change that isn't valid is refused.
 *
 *     npm run notifications:channels-check
 */

import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from "@/lib/notifications/catalog";
import { inQuietHours, localTime, nextLocalHour } from "@/lib/notifications/clock";
import { planDeliveries } from "@/lib/notifications/plan";
import { notificationSettingsSchema } from "@/lib/schemas/notification";
import { toE164 } from "@/lib/sms/phone";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A moment given as a UTC clock reading. */
const at = (iso: string) => new Date(iso);

console.log("");
console.log("THEIR CLOCK");
{
  // 2026-09-24 02:30 UTC is 22:30 the evening before in New York (EDT, UTC-4).
  const late = at("2026-09-24T02:30:00Z");
  const ny = localTime(late, "America/New_York");
  check("reads the hour on their clock, not the server's", ny.hour === 22 && ny.minute === 30, `${ny.hour}:${ny.minute}`);
  check("no zone reads as UTC", localTime(late, null).hour === 2);

  const eight = nextLocalHour(late, "America/New_York", 8);
  check(
    "the next 8 am is tomorrow morning their time",
    eight.toISOString() === "2026-09-24T12:00:00.000Z",
    eight.toISOString()
  );
  const later = nextLocalHour(at("2026-09-24T11:59:00Z"), "America/New_York", 8);
  check(
    "a minute before 8 am, it's in a minute",
    later.toISOString() === "2026-09-24T12:00:00.000Z",
    later.toISOString()
  );
  const passedHour = nextLocalHour(at("2026-09-24T12:00:00Z"), "America/New_York", 8);
  check(
    "at 8 am exactly, the next one is tomorrow",
    passedHour.toISOString() === "2026-09-25T12:00:00.000Z",
    passedHour.toISOString()
  );
}

console.log("");
console.log("QUIET HOURS");
{
  const zone = "America/Chicago"; // CDT, UTC-5 in September
  check("11 pm is inside 9 pm – 7 am", inQuietHours(at("2026-09-24T04:00:00Z"), zone, 21, 7));
  check("3 am is inside 9 pm – 7 am", inQuietHours(at("2026-09-24T08:00:00Z"), zone, 21, 7));
  check("7 am is outside — the window ends as the hour starts", !inQuietHours(at("2026-09-24T12:00:00Z"), zone, 21, 7));
  check("noon is outside", !inQuietHours(at("2026-09-24T17:00:00Z"), zone, 21, 7));
  check("a window within one day works too (1 pm – 3 pm)", inQuietHours(at("2026-09-24T19:30:00Z"), zone, 13, 15));
  check("the same start and end means no quiet hours", !inQuietHours(at("2026-09-24T04:00:00Z"), zone, 22, 22));
}

console.log("");
console.log("WHAT AN EVENT QUEUES");
{
  const settings = (change: Partial<NotificationSettings>): NotificationSettings => ({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    timeZone: "America/New_York",
    ...change,
  });
  const written = [{ id: "n1", userId: "u1" }];
  const lateEvening = at("2026-09-24T02:30:00Z"); // 10:30 pm in New York

  const plain = planDeliveries({
    written,
    wantsEmail: new Set(["u1"]),
    wantsText: new Set(["u1"]),
    settings: new Map([["u1", settings({})]]),
    now: lateEvening,
  });
  check(
    "email as it happens goes now",
    plain.length === 1 && plain[0].channel === "email" && !plain[0].digest && plain[0].nextAttemptAt === lateEvening
  );
  check("a text with no number to go to isn't queued", !plain.some((row) => row.channel === "sms"));

  const daily = planDeliveries({
    written,
    wantsEmail: new Set(["u1"]),
    wantsText: new Set(),
    settings: new Map([["u1", settings({ emailFrequency: "daily", digestHour: 7 })]]),
    now: lateEvening,
  });
  check(
    "once a day holds it for the summary at 7 am their time",
    daily[0]?.digest === true && daily[0].nextAttemptAt.toISOString() === "2026-09-24T11:00:00.000Z",
    daily[0]?.nextAttemptAt.toISOString()
  );

  const quiet = planDeliveries({
    written,
    wantsEmail: new Set(["u1"]),
    wantsText: new Set(["u1"]),
    settings: new Map([
      ["u1", settings({ smsPhone: "+15550100100", quietHours: true, quietStart: 21, quietEnd: 7 })],
    ]),
    now: lateEvening,
  });
  const text = quiet.find((row) => row.channel === "sms");
  const mail = quiet.find((row) => row.channel === "email");
  check(
    "a text at 10:30 pm waits until 7 am",
    text?.nextAttemptAt.toISOString() === "2026-09-24T11:00:00.000Z",
    text?.nextAttemptAt.toISOString()
  );
  check("the email beside it doesn't wait", mail?.nextAttemptAt === lateEvening);

  const daytime = planDeliveries({
    written,
    wantsEmail: new Set(),
    wantsText: new Set(["u1"]),
    settings: new Map([
      ["u1", settings({ smsPhone: "+15550100100", quietHours: true, quietStart: 21, quietEnd: 7 })],
    ]),
    now: at("2026-09-24T16:00:00Z"), // noon in New York
  });
  check("a text at noon goes now", daytime[0]?.nextAttemptAt.toISOString() === "2026-09-24T16:00:00.000Z");

  const unwanted = planDeliveries({
    written,
    wantsEmail: new Set(),
    wantsText: new Set(),
    settings: new Map([["u1", settings({ smsPhone: "+15550100100" })]]),
    now: lateEvening,
  });
  check("a person who wants neither channel gets nothing queued", unwanted.length === 0);
}

console.log("");
console.log("NUMBERS AND SETTINGS");
{
  check("(555) 010-0100 becomes +15550100100", toE164("(555) 010-0100") === "+15550100100");
  check("1-555-010-0100 becomes +15550100100", toE164("1-555-010-0100") === "+15550100100");
  check("+44 20 7946 0000 stays international", toE164("+44 20 7946 0000") === "+442079460000");
  check("seven digits isn't a number we can text", toE164("555-0100") === null);

  const saved = notificationSettingsSchema.safeParse({ smsPhone: "555.010.0100", timeZone: "America/Denver" });
  check("a typed number is stored as E.164", saved.success && saved.data.smsPhone === "+15550100100");
  check("blank clears the number", notificationSettingsSchema.safeParse({ smsPhone: "" }).data?.smsPhone === null);
  check("a number that isn't one is refused", !notificationSettingsSchema.safeParse({ smsPhone: "call me" }).success);
  check("a time zone that doesn't exist is refused", !notificationSettingsSchema.safeParse({ timeZone: "Mars/Olympus" }).success);
  check("an hour past 23 is refused", !notificationSettingsSchema.safeParse({ digestHour: 24 }).success);
  check("a frequency we don't have is refused", !notificationSettingsSchema.safeParse({ emailFrequency: "weekly" }).success);
}

console.log("");
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
