import { requireAdmin } from "@/lib/admin/access";
import { getUsageProviders } from "@/lib/admin/usage";
import { UsageDashboard } from "@/components/admin/usage-dashboard";

export default async function UsagePage() {
  await requireAdmin();
  return <UsageDashboard initial={await getUsageProviders()} />;
}
