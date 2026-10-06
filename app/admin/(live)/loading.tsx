import { DashboardSkeleton } from "@/components/admin/dashboard-skeleton";

/**
 * While the server reads the live dashboard's first events and who's online,
 * the dashboard's own skeleton — the same layout the page fills, so nothing
 * moves when it arrives. In its own route group so it never stands in for
 * another admin page.
 */
export default function Loading() {
  return <DashboardSkeleton />;
}
