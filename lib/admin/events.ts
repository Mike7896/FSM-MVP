import "server-only";

import { desc, gt } from "drizzle-orm";

import type { LiveEvent } from "@/components/admin/use-live";
import { db } from "@/lib/db";
import { adminEvents, type AdminEvent } from "@/lib/db/schema";

/**
 * The event log, read for the live feed.
 *
 * Realtime pushes each new line, but a push can be missed: the connection
 * drops for a moment, the tab sleeps, the page was still loading when a line
 * landed. So the feed also asks for everything after the last line it has —
 * whenever it reconnects, and whenever the database says something changed —
 * and nothing that happened is ever just absent.
 */

/** A row in the shape Realtime delivers — straight from Postgres, snake_case — so the feed treats both alike. */
export function toLiveEvent(event: AdminEvent): LiveEvent {
  return {
    id: event.id,
    occurred_at: event.occurredAt.toISOString(),
    kind: event.kind,
    level: event.level,
    organization_id: event.organizationId,
    org_name: event.orgName,
    user_id: event.userId,
    title: event.title,
    amount_cents: event.amountCents,
    test: event.test,
    internal: event.internal,
    demo: event.demo,
    data: event.data,
  };
}

/** The newest lines, for the dashboard to open full. Newest first. */
export async function newestEvents(limit = 300): Promise<LiveEvent[]> {
  const rows = await db.select().from(adminEvents).orderBy(desc(adminEvents.id)).limit(limit);
  return rows.map(toLiveEvent);
}

/**
 * The lines after `after`, oldest first — the newest `limit` of them. `more`
 * says the gap was bigger than that; the rest are in the Event log.
 */
export async function eventsAfter(after: number, limit = 500): Promise<{ events: LiveEvent[]; more: boolean }> {
  const rows = await db
    .select()
    .from(adminEvents)
    .where(gt(adminEvents.id, after))
    .orderBy(desc(adminEvents.id))
    .limit(limit);
  return { events: rows.reverse().map(toLiveEvent), more: rows.length === limit };
}
