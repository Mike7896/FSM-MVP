import { requireAdmin } from "@/lib/admin/access";
import { listReleases } from "@/lib/release-notes/service";
import { ReleaseManager } from "@/components/admin/release-manager";

export default async function ReleasesPage() {
  await requireAdmin();
  const releases = await listReleases(true);
  return <ReleaseManager releases={releases.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null }))} />;
}
