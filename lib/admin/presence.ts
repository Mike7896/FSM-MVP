import "server-only";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, userPresence } from "@/lib/db/schema";
import { realUser } from "./counting";

/** Call only after the platform-admin authorization gate. */
export async function recentPresence() {
  const rows = await db.select({ presence: userPresence, business: organizations.name })
    .from(userPresence).leftJoin(organizations, eq(organizations.id, userPresence.organizationId))
    .where(and(gt(userPresence.lastSeen, sql`now() - interval '7 days'`), realUser(sql`${userPresence.userId}`)))
    .orderBy(desc(userPresence.lastSeen));
  return rows.map(({ presence: row, business }) => ({
    user_id: row.userId, organization_id: row.organizationId, area: row.area,
    device: row.device, last_seen: row.lastSeen.toISOString(), business,
  }));
}
