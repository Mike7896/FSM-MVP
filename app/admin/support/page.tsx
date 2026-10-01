import type { Metadata } from "next";
import { sql } from "drizzle-orm";

import { SupportInbox } from "@/components/admin/support-inbox";
import { requireAdmin } from "@/lib/admin/access";
import type { Row } from "@/lib/admin/metrics";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Support" };

/** Every support request — open first — with reply, answered and close. */
export default async function SupportPage() {
  await requireAdmin();
  const rows = await db.execute<Row>(sql`
    select r.id, r.number, r.kind::text as kind, r.subject, r.body, r.status::text as status, r.page,
      r.reply_to, r.created_at, r.emailed_at, r.sentry_event_id,
      o.name as business, p.full_name as name
    from support_requests r
    left join organizations o on o.id = r.organization_id
    left join profiles p on p.id = r.user_id
    order by (r.status = 'open') desc, r.created_at desc
    limit 200
  `);
  const counts = await db.execute<{ status: string; n: number }>(
    sql`select status::text as status, count(*)::int as n from support_requests group by 1`
  );
  const count = (status: string) => [...counts].find((row) => row.status === status)?.n ?? 0;

  return (
    <div className="flex flex-col gap-4 p-3 md:p-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Support</h1>
        <span className="text-muted-foreground text-sm">
          {count("open")} open · {count("answered")} answered · {count("closed")} closed
        </span>
      </div>
      <SupportInbox rows={[...rows]} />
    </div>
  );
}
