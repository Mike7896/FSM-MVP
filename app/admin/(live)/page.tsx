import type { Metadata } from "next";

import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { requireAdmin } from "@/lib/admin/access";
import { newestEvents } from "@/lib/admin/events";
import { recentPresence } from "@/lib/admin/presence";

export const metadata: Metadata = { title: "Live" };

/** Admin-only initial snapshot; the client reconciles after subscribing. */
export default async function AdminPage() {
  const admin = await requireAdmin();

  const initialEvents = await newestEvents(500);
  const initialPresence = await recentPresence();

  return (
    <AdminDashboard
      initialEvents={initialEvents}
      initialPresence={initialPresence}
      adminEmail={admin.email}
    />
  );
}
