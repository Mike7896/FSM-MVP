/** Tests the migration in a rolled-back transaction; sends no email. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { releaseInput } from "../lib/schemas/product-release";

const good = { version: "0.1.0", title: "Product updates", items: [{ kind: "new", text: "Create a quote." }] };
assert(releaseInput.safeParse(good).success);
for (const version of ["1", "v1.0.0", "01.0.0", "1.0.0-beta", ""]) assert(!releaseInput.safeParse({ ...good, version }).success);
assert(!releaseInput.safeParse({ ...good, items: [] }).success);
assert(!releaseInput.safeParse({ ...good, title: " " }).success);
assert(!releaseInput.safeParse({ ...good, items: [{ kind: "new", text: " " }] }).success);
console.log("Release input validation passed.");

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL to run the rollback-only migration checks.");
const client = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
const rollback = new Error("expected rollback");
try {
  await client.begin(async tx => {
    const [{ exists }] = await tx`select to_regclass('public.product_releases') is not null as exists`;
    if (!exists) {
      for (const statement of readFileSync("drizzle/0042_product_updates.sql", "utf8").split("--> statement-breakpoint")) if (statement.trim()) await tx.unsafe(statement);
    }
    const version = `0.0.${Date.now()}`;
    const [draft] = await tx`insert into product_releases (version, title, items) values (${version}, 'Check', ${tx.json(good.items)}) returning id, published_at`;
    assert.equal(draft.published_at, null);
    const duplicates = await tx`insert into product_releases (version, title, items) values (${version}, 'Duplicate', '[]') on conflict do nothing returning id`;
    assert.equal(duplicates.length, 0);
    assert.equal((await tx`select id from product_releases where id = ${draft.id} and published_at is not null`).length, 0);
    await tx`update product_releases set published_at = now() where id = ${draft.id} and published_at is null`;
    assert.equal((await tx`update product_releases set title = 'Changed' where id = ${draft.id} and published_at is null returning id`).length, 0);
    const security = await tx`select relname, relrowsecurity from pg_class where relname in ('product_releases', 'support_replies') and relnamespace = 'public'::regnamespace`;
    assert.equal(security.length, 2);
    assert(security.every(row => row.relrowsecurity));
    const [grants] = await tx`select has_table_privilege('authenticated', 'support_replies', 'SELECT') as replies, has_table_privilege('anon', 'product_releases', 'SELECT') as releases`;
    assert.equal(grants.replies, false); assert.equal(grants.releases, false);
    const [ticket] = await tx`insert into support_requests (kind, subject, body, reply_to, user_agent) values ('help', 'Reply check', 'Test request', 'nobody@example.com', 'product-updates-check') returning id`;
    const replyId = randomUUID();
    await tx`insert into support_replies (id, request_id, recipient, reply_to, subject, body) values (${replyId}, ${ticket.id}, 'nobody@example.com', 'support@example.com', 'Reply check', 'Saved before send')`;
    const duplicateReply = await tx`insert into support_replies (id, request_id, recipient, reply_to, subject, body) values (${replyId}, ${ticket.id}, 'nobody@example.com', 'support@example.com', 'Reply check', 'Duplicate') on conflict do nothing returning id`;
    assert.equal(duplicateReply.length, 0);
    const [savedReply] = await tx`select * from support_replies where id = ${replyId} for update`;
    assert.equal(savedReply.body, 'Saved before send'); assert.equal(savedReply.sent_at, null);
    await tx`update support_replies set sent_at = now(), provider_id = 'mock-provider' where id = ${replyId}`;
    await tx`update support_requests set status = 'answered' where id = ${ticket.id}`;
    assert.equal((await tx`select status from support_requests where id = ${ticket.id}`)[0].status, 'answered');
    console.log("Support reply persistence, duplicate IDs, and send status passed.");
    console.log("Migration, unique versions, draft visibility, publish guard, and access restrictions passed.");
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally { await client.end(); }
console.log("All database changes rolled back. No emails sent.");
