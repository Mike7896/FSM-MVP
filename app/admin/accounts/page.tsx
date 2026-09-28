import type { Metadata } from "next";

import { AccountsView } from "@/components/admin/accounts-view";
import { requireAdmin } from "@/lib/admin/access";
import { listAccounts, type AccountFilter } from "@/lib/admin/accounts";

export const metadata: Metadata = { title: "Accounts" };

const FILTERS = new Set<AccountFilter>(["all", "admins", "testers", "suspended"]);

/** Every account, searchable — and the door to making a test one. */
export default async function AccountsPage({ searchParams }: PageProps<"/admin/accounts">) {
  await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const filter = typeof params.filter === "string" && FILTERS.has(params.filter as AccountFilter)
    ? (params.filter as AccountFilter)
    : "all";

  const accounts = await listAccounts({ q, filter });
  return <AccountsView accounts={accounts} filter={filter} q={q} />;
}
