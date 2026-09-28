import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  notificationPreferences,
  notificationSettings,
} from "@/lib/db/schema";

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_KINDS,
  type NotificationChannel,
  type NotificationKind,
  type NotificationPreference,
  type NotificationSettings,
} from "./catalog";

/**
 * What reaches each person, per event and channel — screen 44.
 *
 * Stored rows are only the choices somebody made; every other cell is the
 * catalog's default. That is what lets a better default reach everyone who
 * never opened Settings.
 */

/** Every row of screen 44 for this person, defaults filled in. */
export async function listPreferences(
  userId: string
): Promise<NotificationPreference[]> {
  const saved = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));

  const byKind = new Map(saved.map((row) => [row.kind, row]));

  return NOTIFICATION_KINDS.map((entry) => {
    const row = byKind.get(entry.kind);
    return {
      kind: entry.kind,
      label: entry.label,
      push: row?.push ?? entry.push,
      email: row?.email ?? entry.email,
      sms: row?.sms ?? entry.sms,
    };
  });
}

/**
 * Change one event's channels for this person.
 *
 * Every channel is written, not just the one that changed: once someone has an
 * opinion about an event, a default moving underneath the rest of it would be
 * a setting changing on its own.
 */
export async function setPreference(
  userId: string,
  kind: NotificationKind,
  change: Partial<Record<NotificationChannel, boolean>>
): Promise<NotificationPreference> {
  const current = (await listPreferences(userId)).find(
    (row) => row.kind === kind
  )!;
  const next = {
    push: change.push ?? current.push,
    email: change.email ?? current.email,
    sms: change.sms ?? current.sms,
  };

  await db
    .insert(notificationPreferences)
    .values({ userId, kind, ...next })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.kind],
      set: { ...next, updatedAt: new Date() },
    });

  return { ...current, ...next };
}

/** Which of these people want this event on this channel. */
export async function wantsChannel(
  userIds: string[],
  kind: NotificationKind,
  channel: NotificationChannel
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  const saved = await db
    .select({
      userId: notificationPreferences.userId,
      push: notificationPreferences.push,
      email: notificationPreferences.email,
      sms: notificationPreferences.sms,
    })
    .from(notificationPreferences)
    .where(
      and(
        inArray(notificationPreferences.userId, userIds),
        eq(notificationPreferences.kind, kind)
      )
    );

  const chosen = new Map(saved.map((row) => [row.userId, row[channel]]));
  const fallback =
    NOTIFICATION_KINDS.find((entry) => entry.kind === kind)?.[channel] ?? false;

  return new Set(userIds.filter((userId) => chosen.get(userId) ?? fallback));
}

/* ── How each person is reached ───────────────────────────────────────── */

/** One person's settings, or the defaults when they have never saved any. */
export async function getSettings(userId: string): Promise<NotificationSettings> {
  return (await settingsFor([userId])).get(userId)!;
}

/** Several people's settings at once — what `notify` reads per event. */
export async function settingsFor(
  userIds: string[]
): Promise<Map<string, NotificationSettings>> {
  const rows = userIds.length
    ? await db
        .select()
        .from(notificationSettings)
        .where(inArray(notificationSettings.userId, userIds))
    : [];

  const byUser = new Map(rows.map((row) => [row.userId, row]));

  return new Map(
    userIds.map((userId) => {
      const row = byUser.get(userId);
      return [
        userId,
        row
          ? {
              emailFrequency: row.emailFrequency,
              digestHour: row.digestHour,
              smsPhone: row.smsPhone,
              quietHours: row.quietHours,
              quietStart: row.quietStart,
              quietEnd: row.quietEnd,
              timeZone: row.timeZone,
              toasts: row.toasts,
            }
          : { ...DEFAULT_NOTIFICATION_SETTINGS },
      ];
    })
  );
}

/** Save part of this person's settings; what isn't sent keeps its value. */
export async function saveSettings(
  userId: string,
  change: Partial<NotificationSettings>
): Promise<NotificationSettings> {
  const next = { ...(await getSettings(userId)), ...change };

  await db
    .insert(notificationSettings)
    .values({ userId, ...next })
    .onConflictDoUpdate({
      target: notificationSettings.userId,
      set: { ...next, updatedAt: new Date() },
    });

  return next;
}
