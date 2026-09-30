/** Read-only checks against the configured database. No test accounts or business records are created. */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getDashboard } from "@/lib/queries/dashboard";
import { collectedForInvoice } from "@/lib/ledger";

async function main() {
const organizations = await db.execute<{ id: string }>(sql`select id from organizations order by created_at limit 5`);
let checked = 0;
try {
  for (const org of organizations) {
    const dashboard = await getDashboard(org.id, "America/New_York");
    const due = await db.execute<{ id: string }>(sql`
      select t.id from tasks t left join jobs j on j.id=t.job_id
      where t.organization_id=${org.id} and t.status not in ('done','cancelled')
        and t.due_on <= ${dashboard.today}::date and (t.job_id is null or not j.is_demo)
    `);
    assert.deepEqual(
      dashboard.thisWeek.filter(item => item.kind === 'task' && item.on <= dashboard.today).map(item => item.href).sort(),
      [...due].map(item => `/tasks?task=${item.id}`).sort(),
      'Every due task should remain actionable, including overdue tasks',
    );
    for (const item of dashboard.thisWeek) {
      assert.ok(item.href.startsWith('/'));
      assert.match(item.on, /^\d{4}-\d{2}-\d{2}$/);
    }
    // Independently count all outstanding overdue invoices, not a six-row sample.
    const overdue = await db.execute<{ id: string }>(sql`
      select d.id from documents d join invoice_details i on i.document_id=d.id
        join jobs j on j.id=d.job_id
      where d.organization_id=${org.id} and d.type='invoice' and not j.is_demo
        and d.status not in ('draft','paid','void') and i.voided_at is null
        and i.due_on < ${dashboard.today}::date
        and i.amount_due_cents > ${collectedForInvoice(sql.raw("d.id"))}
    `);
    assert.deepEqual(dashboard.moneyToCollect.rows.filter(row=>row.action==='Chase').map(row=>row.href).sort(), [...overdue].map(row=>`/invoices/${row.id}`).sort());
    checked++;
  }
  console.log(`Dashboard queries passed for ${checked} organizations; no records changed.`);
} finally { process.exitCode = checked === organizations.length ? 0 : 1; }
process.exit();
}

void main().catch((error) => { console.error(error); process.exit(1); });
