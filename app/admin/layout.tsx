import type { Metadata } from "next";

import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdmin } from "@/lib/admin/access";

export const metadata: Metadata = {
  title: { template: "%s · ServiceClerk admin", default: "ServiceClerk admin" },
  robots: { index: false, follow: false },
};

/**
 * The admin section — for the people who build ServiceClerk. Its own shell,
 * not the app's: anyone who isn't an admin gets a 404 here, before any page
 * inside it renders.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdmin();
  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <AdminNav email={admin.email} owner={admin.owner} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
