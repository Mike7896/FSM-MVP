import type { Metadata } from "next";
import { and, desc, eq, gt, sql } from "drizzle-orm";

import { AdminDashboard } from "@/components/admin/admin-dashboard";
import type { LiveEvent, PresenceRow } from "@/components/admin/use-live";
import { requireAdmin } from "@/lib/admin/access";
import { realUser } from "@/lib/admin/metrics";
import { db } from "@/lib/db";
import { adminEvents, organizations, userPresence } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Live" };

/**
 * /admin — the live dashboard, for ServiceClerk's own developers.
 *
 * Gated by `ADMIN_EMAILS`: anyone else gets a 404. The last few hundred
 * events and who's been online are read here so the page opens full; from
 * then on Supabase Realtime keeps it current.
 */
export default async function AdminPage() {
  const admin = await requireAdmin();

  // One after the other: fired together on the single dev connection, queries
  // can stall until the statement timeout.
  const events = await db.select().from(adminEvents).orderBy(desc(adminEvents.id)).limit(300);
  const presence = await db
      .select({ presence: userPresence, business: organizations.name })
      .from(userPresence)
      .leftJoin(organizations, eq(organizations.id, userPresence.organizationId))
      .where(and(gt(userPresence.lastSeen, sql`now() - interval '15 minutes'`), realUser(sql`${userPresence.userId}`)))
      .orderBy(desc(userPresence.lastSeen));

  // The same shape Realtime delivers — straight from Postgres, snake_case.
  const initialEvents: LiveEvent[] = events.map((event) => ({
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
    demo: event.demo,
    data: event.data,
  }));
  const initialPresence: (PresenceRow & { business: string | null })[] = presence.map((row) => ({
    user_id: row.presence.userId,
    organization_id: row.presence.organizationId,
    area: row.presence.area,
    device: row.presence.device,
    last_seen: row.presence.lastSeen.toISOString(),
    business: row.business,
  }));

  return (
    <AdminDashboard
      initialEvents={initialEvents}
      initialPresence={initialPresence}
      adminEmail={admin.email}
    />
  );
}
