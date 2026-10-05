import type { Metadata } from "next";
import { and, desc, eq, gt, sql } from "drizzle-orm";

import { AdminDashboard } from "@/components/admin/admin-dashboard";
import type { PresenceRow } from "@/components/admin/use-live";
import { requireAdmin } from "@/lib/admin/access";
import { newestEvents } from "@/lib/admin/events";
import { realUser } from "@/lib/admin/metrics";
import { db } from "@/lib/db";
import { organizations, userPresence } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Live" };

/**
 * /admin — the live dashboard, for ServiceClerk's own developers.
 *
 * Gated by `ADMIN_EMAILS`: anyone else gets a 404. The last few hundred
 * events and everyone seen this week are read here so the page opens full —
 * the week, because "active in 7 days" is counted from these rows in the
 * browser. From then on Supabase Realtime keeps it current, and anything it
 * misses is caught up from `/api/v1/admin/events`.
 */
export default async function AdminPage() {
  const admin = await requireAdmin();

  // One after the other: fired together on the single dev connection, queries
  // can stall until the statement timeout.
  const initialEvents = await newestEvents(300);
  const presence = await db
      .select({ presence: userPresence, business: organizations.name })
      .from(userPresence)
      .leftJoin(organizations, eq(organizations.id, userPresence.organizationId))
      .where(and(gt(userPresence.lastSeen, sql`now() - interval '7 days'`), realUser(sql`${userPresence.userId}`)))
      .orderBy(desc(userPresence.lastSeen));

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
