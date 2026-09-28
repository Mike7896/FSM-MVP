import "server-only";

import { and, asc, eq, inArray, lte, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  notificationDeliveries,
  notificationSettings,
  notifications,
  profiles,
  type DeliveryStatus,
  type NotificationDelivery,
} from "@/lib/db/schema";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { absoluteUrl } from "@/lib/env";
import { sendSms, smsConfigured } from "@/lib/sms/send";

import { NOTIFICATION_KINDS } from "./catalog";
import { digestEmail, notificationEmail } from "./email";

/**
 * Getting a notification to where the person is.
 *
 * The same shape as the connector queue (`lib/connectors/queue.ts`), for the
 * same reasons: a row per delivery, claimed with `for update skip locked` so
 * two senders never take the same one, retried with backoff, and given up on
 * with the reason written down. The first attempt runs right after the event;
 * the cron is the net under it.
 *
 * Three channels: **email** through Resend, **texts** through Twilio, and
 * **push**, which is saved for the phone app and skipped until it exists. An
 * email held for the **daily summary** is not sent on its own at all — the
 * summary sends every held email for one person together, at their hour.
 */

/** Give up after this many tries. */
const MAX_ATTEMPTS = 5;

/** Minutes to wait after each failed attempt. */
const BACKOFF_MINUTES = [1, 5, 30, 120, 720];

/** A claim this old belongs to a sender that died mid-send. */
const STALE_CLAIM_MINUTES = 10;

export type DeliveryTally = {
  sent: number;
  retrying: number;
  dead: number;
  skipped: number;
};

/** Send these now — the first attempt, straight after the event. */
export async function deliver(ids: string[]): Promise<DeliveryTally> {
  if (ids.length === 0) return tally();

  const claimed = await claim(
    and(
      inArray(notificationDeliveries.id, ids),
      // Never re-take one another sender already has, never send a held
      // summary email on its own, and never early — a text held through quiet
      // hours waits for morning even when it was queued a second ago.
      inArray(notificationDeliveries.status, ["pending", "failed"]),
      eq(notificationDeliveries.digest, false),
      lte(notificationDeliveries.nextAttemptAt, new Date())
    )!,
    ids.length
  );

  return send(claimed);
}

/** Send whatever is due: retries, and anything whose first attempt never ran. */
export async function deliverDue(limit = 25): Promise<DeliveryTally> {
  const now = new Date();
  const abandoned = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000);

  const claimed = await claim(
    and(
      eq(notificationDeliveries.digest, false),
      or(
        and(
          inArray(notificationDeliveries.status, ["pending", "failed"]),
          lte(notificationDeliveries.nextAttemptAt, now)
        ),
        and(
          eq(notificationDeliveries.status, "sending"),
          lte(notificationDeliveries.claimedAt, abandoned)
        )
      )
    )!,
    limit
  );

  return send(claimed);
}

/**
 * The daily summaries that are due — one email per person, holding every
 * notification queued for them since the last one.
 */
export async function sendDigests(limit = 200): Promise<DeliveryTally> {
  const result = tally();
  const now = new Date();
  const abandoned = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000);

  const claimed = await claim(
    and(
      eq(notificationDeliveries.digest, true),
      or(
        and(
          inArray(notificationDeliveries.status, ["pending", "failed"]),
          lte(notificationDeliveries.nextAttemptAt, now)
        ),
        and(
          eq(notificationDeliveries.status, "sending"),
          lte(notificationDeliveries.claimedAt, abandoned)
        )
      )
    )!,
    limit
  );
  if (claimed.length === 0) return result;

  const rows = await db
    .select({
      id: notificationDeliveries.id,
      userId: notifications.userId,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      createdAt: notifications.createdAt,
      email: profiles.email,
    })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
    .innerJoin(profiles, eq(notifications.userId, profiles.id))
    .where(inArray(notificationDeliveries.id, claimed.map((row) => row.id)));

  const byUser = new Map<string, typeof rows>();
  for (const row of rows) {
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  }

  // Anything claimed whose person has no profile any more has nowhere to go.
  const known = new Set(rows.map((row) => row.id));
  for (const delivery of claimed.filter((row) => !known.has(row.id))) {
    await settle(delivery.id, "dead", {
      lastError: "The person this was for no longer has a profile.",
    });
    result.dead += 1;
  }

  for (const items of byUser.values()) {
    const ids = items.map((item) => item.id);

    if (!emailConfigured()) {
      await settleMany(ids, "skipped", { lastError: "Email isn't set up on this server." });
      result.skipped += ids.length;
      continue;
    }

    try {
      const newest = [...items].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
      const sent = await sendEmail({
        to: items[0].email,
        fromName: "ServiceClerk",
        ...(await digestEmail(
          newest.map((item) => ({
            title: item.title,
            body: item.body,
            href: item.href,
            action: actionFor(item.kind),
          }))
        )),
      });
      await settleMany(ids, "sent", {
        recipient: items[0].email,
        providerMessageId: sent.id,
        sentAt: new Date(),
        lastError: null,
      });
      result.sent += ids.length;
    } catch (error) {
      const attempts = Math.max(
        ...claimed.filter((row) => ids.includes(row.id)).map((row) => row.attempts)
      );
      const dead = attempts >= MAX_ATTEMPTS;
      await settleMany(ids, dead ? "dead" : "failed", {
        lastError: messageOf(error, "The email service didn't say why."),
        nextAttemptAt: new Date(Date.now() + backoff(attempts) * 60_000),
      }).catch(() => {});
      if (dead) result.dead += ids.length;
      else result.retrying += ids.length;
    }
  }

  return result;
}

/**
 * Take a batch and mark it taken in one statement — the claim is the lock.
 * Built with the query builder so the returned rows are camelCase (see
 * `claimDue` in the connector queue).
 */
async function claim(where: SQL, limit: number): Promise<NotificationDelivery[]> {
  const due = db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(where)
    .orderBy(asc(notificationDeliveries.nextAttemptAt))
    .limit(limit)
    .for("update", { skipLocked: true });

  return db
    .update(notificationDeliveries)
    .set({
      status: "sending",
      claimedAt: new Date(),
      attempts: sql`${notificationDeliveries.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(inArray(notificationDeliveries.id, due))
    .returning();
}

async function send(claimed: NotificationDelivery[]): Promise<DeliveryTally> {
  const result = tally();
  if (claimed.length === 0) return result;

  // What each one says and where it goes, in one read. The address and the
  // number are read at send time, so a change is honored on a retry.
  const rows = await db
    .select({
      id: notificationDeliveries.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      email: profiles.email,
      phone: notificationSettings.smsPhone,
    })
    .from(notificationDeliveries)
    .innerJoin(
      notifications,
      eq(notificationDeliveries.notificationId, notifications.id)
    )
    .innerJoin(profiles, eq(notifications.userId, profiles.id))
    .leftJoin(notificationSettings, eq(notificationSettings.userId, notifications.userId))
    .where(
      inArray(
        notificationDeliveries.id,
        claimed.map((delivery) => delivery.id)
      )
    );

  const about = new Map(rows.map((row) => [row.id, row]));

  for (const delivery of claimed) {
    const item = about.get(delivery.id);

    try {
      if (!item) {
        await settle(delivery.id, "dead", {
          lastError: "The person this was for no longer has a profile.",
        });
        result.dead += 1;
        continue;
      }

      if (delivery.channel === "push") {
        await settle(delivery.id, "skipped", {
          lastError: "Nothing delivers push yet — it waits for the phone app.",
        });
        result.skipped += 1;
        continue;
      }

      if (delivery.channel === "sms") {
        // Skipped, not queued, for the same reason as email below.
        if (!smsConfigured()) {
          await settle(delivery.id, "skipped", {
            lastError: "Texts aren't set up on this server.",
          });
          result.skipped += 1;
          continue;
        }
        if (!item.phone) {
          await settle(delivery.id, "skipped", {
            lastError: "There's no number to text.",
          });
          result.skipped += 1;
          continue;
        }

        const sent = await sendSms({
          to: item.phone,
          // Who it's from first — a text from an unknown number that doesn't
          // say who it is reads as spam — then the state and the link.
          body: `ServiceClerk: ${item.title}. ${absoluteUrl(item.href)}`,
        });
        await settle(delivery.id, "sent", {
          recipient: item.phone,
          providerMessageId: sent.id,
          sentAt: new Date(),
          lastError: null,
        });
        result.sent += 1;
        continue;
      }

      // Skipped, not queued: the day a key is added, every notification since
      // launch must not go out at once about jobs long since settled.
      if (!emailConfigured()) {
        await settle(delivery.id, "skipped", {
          lastError: "Email isn't set up on this server.",
        });
        result.skipped += 1;
        continue;
      }

      const entry = NOTIFICATION_KINDS.find((kind) => kind.kind === item.kind);
      const sent = await sendEmail({
        to: item.email,
        fromName: "ServiceClerk",
        ...(await notificationEmail({
          title: item.title,
          body: item.body,
          href: item.href,
          action: entry?.action ?? "Open it",
          reason: entry?.label ?? null,
        })),
      });

      await settle(delivery.id, "sent", {
        recipient: item.email,
        providerMessageId: sent.id,
        sentAt: new Date(),
        lastError: null,
      });
      result.sent += 1;
    } catch (error) {
      const dead = delivery.attempts >= MAX_ATTEMPTS;

      await settle(delivery.id, dead ? "dead" : "failed", {
        lastError: messageOf(
          error,
          delivery.channel === "sms"
            ? "The text service didn't say why."
            : "The email service didn't say why."
        ),
        nextAttemptAt: new Date(Date.now() + backoff(delivery.attempts) * 60_000),
      }).catch(() => {});

      if (dead) result.dead += 1;
      else result.retrying += 1;
    }
  }

  return result;
}

async function settle(
  id: string,
  status: DeliveryStatus,
  fields: Partial<typeof notificationDeliveries.$inferInsert>
) {
  await settleMany([id], status, fields);
}

async function settleMany(
  ids: string[],
  status: DeliveryStatus,
  fields: Partial<typeof notificationDeliveries.$inferInsert>
) {
  if (ids.length === 0) return;
  await db
    .update(notificationDeliveries)
    .set({ ...fields, status, claimedAt: null, updatedAt: new Date() })
    .where(inArray(notificationDeliveries.id, ids));
}

function actionFor(kind: string) {
  return NOTIFICATION_KINDS.find((entry) => entry.kind === kind)?.action ?? "Open it";
}

function backoff(attempts: number) {
  return BACKOFF_MINUTES[
    Math.min(Math.max(attempts - 1, 0), BACKOFF_MINUTES.length - 1)
  ];
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message.slice(0, 300) : fallback;
}

function tally(): DeliveryTally {
  return { sent: 0, retrying: 0, dead: 0, skipped: 0 };
}
