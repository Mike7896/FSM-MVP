"use client";

import { useRouter } from "next/navigation";

import type { Row } from "@/lib/admin/metrics";

import { SupportPanel } from "./admin-panels";

/** The support inbox on its own page — the same panel as on Live, refreshed from the server. */
export function SupportInbox({ rows }: { rows: Row[] }) {
  const router = useRouter();
  return <SupportPanel rows={rows} onChanged={() => router.refresh()} />;
}
