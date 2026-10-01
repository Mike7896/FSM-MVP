import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccountDetail } from "@/components/admin/account-detail";
import { requireAdmin } from "@/lib/admin/access";
import { getAccount } from "@/lib/admin/accounts";

export const metadata: Metadata = { title: "Account" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One account, and what an admin can do to it. */
export default async function AccountPage({ params }: PageProps<"/admin/accounts/[id]">) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const account = await getAccount(id);
  if (!account) notFound();
  return <AccountDetail account={account} me={admin.userId} />;
}
