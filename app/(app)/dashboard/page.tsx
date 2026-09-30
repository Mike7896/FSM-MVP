import type { Metadata } from "next";

import { DashboardHome } from "@/components/dashboard-home";
import { requireActiveOrganization } from "@/lib/dal";
import { getStartState } from "@/lib/queries/activation";
import { getDashboard } from "@/lib/queries/dashboard";
import { getOfficeIdentity } from "@/lib/queries/office";

export const metadata: Metadata = { title: "Dashboard" };

/** A daily briefing: real work, ordered actions, and a calendar on the viewer's clock. */
export default async function DashboardPage() {
  const org = await requireActiveOrganization();
  const [dashboard, office, start] = await Promise.all([
    getDashboard(org.id),
    getOfficeIdentity(org.id),
    getStartState(org.id),
  ]);
  return <DashboardHome organizationId={org.id} initialData={dashboard} businessName={office.businessName} license={office.license} start={start} />;
}
