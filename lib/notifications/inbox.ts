import "server-only";

import { and, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

import type { InboxItem } from "./catalog";

/**
 * The notifications as the app shows them — the bell, and the pop-ups.
 *
 * **Every notification is here, whatever the channels say.** Email and texts
 * are for when someone isn't looking; the app is where the business already
 * is, so there is no switch that keeps something out of it.
 *
 * Scoped to the person *and* the Office they're in: someone in two shops sees
 * one shop's news at a time, like everything else.
 */

/** How many the bell holds. Older ones are still on the records they're about. */
const INBOX_SIZE = 30;

export async function listInbox(
  userId: string,
  organizationId: string,
  options?: {
    /** Only what arrived after this — the pop-ups asking "anything new?". */
    after?: Date;
  }
): Promise<{ items: InboxItem[]; unread: number }> {
  const mine = and(
    eq(notifications.userId, userId),
    eq(notifications.organizationId, organizationId)
  );

  const [rows, [unread]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        title: notifications.title,
        body: notifications.body,
        href: notifications.href,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .where(
        options?.after ? and(mine, gt(notifications.createdAt, options.after)) : mine
      )
      .orderBy(desc(notifications.createdAt))
      .limit(INBOX_SIZE),
    db
      .select({ count: count() })
      .from(notifications)
      .where(and(mine, isNull(notifications.readAt))),
  ]);

  return {
    items: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    })),
    unread: unread?.count ?? 0,
  };
}

/** Mark some — or all — of this person's notifications here as read. */
export async function markRead(
  userId: string,
  organizationId: string,
  which: string[] | "all"
): Promise<void> {
  if (which !== "all" && which.length === 0) return;

  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.organizationId, organizationId),
        isNull(notifications.readAt),
        which === "all" ? undefined : inArray(notifications.id, which)
      )
    );
}
