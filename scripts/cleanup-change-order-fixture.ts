import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema/office";

export async function cleanupChangeOrderFixture(id: string) {
  await db.transaction(async tx => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, id));
    assert.ok(org?.slug.startsWith('co-check-'), 'Cleanup must target only this script’s test organization');
    // Frozen-document guards intentionally prevent normal deletion. This setting
    // is local to this cleanup transaction/connection; no global triggers change.
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`delete from share_link_views where share_link_id in (select id from share_links where document_id in (select id from documents where organization_id=${id}))`);
    await tx.execute(sql`delete from share_links where document_id in (select id from documents where organization_id=${id})`);
    await tx.execute(sql`delete from change_requests where contract_id in (select id from documents where organization_id=${id})`);
    for (const table of ['document_signatures','document_sends','scope_nodes','change_order_details','contract_details','invoice_details']) {
      await tx.execute(sql`delete from ${sql.identifier(table)} where document_id in (select id from documents where organization_id=${id})`);
    }
    await tx.execute(sql`delete from draw_schedule where job_id in (select id from jobs where organization_id=${id})`);
    await tx.execute(sql`delete from documents where organization_id=${id}`);
    await tx.execute(sql`delete from jobs where organization_id=${id}`);
    await tx.execute(sql`delete from customers where organization_id=${id}`);
    await tx.execute(sql`delete from memberships where organization_id=${id}`);
    await tx.delete(organizations).where(eq(organizations.id,id));
  });
}
