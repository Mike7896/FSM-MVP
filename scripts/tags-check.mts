import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tagPredicate } from "@/lib/queries/tags";
import { tagSchema, tagIds, type TagEntity } from "@/lib/tags";

// Every fixture and mutation rolls back, including the temporary organizations.
const rollback = new Error("fixture rollback");
let checks = 0;
function check(value: unknown, label: string) {
  assert.ok(value, label);
  console.log(`ok ${++checks}: ${label}`);
}
try {
  await db.transaction(async (tx) => {
    const [a, b] = await tx.execute<{ id: string }>(
      sql`insert into organizations(name,slug) values ('Tag test',${`tags-check-${randomUUID()}`}),('Tag test other',${`tags-check-${randomUUID()}`}) returning id`,
    );
    const [customer] = await tx.execute<{ id: string }>(
      sql`insert into customers(organization_id,name) values (${a.id},'Tag fixture') returning id`,
    );
    const [job] = await tx.execute<{ id: string }>(
      sql`insert into jobs(organization_id,customer_id,name) values (${a.id},${customer.id},'Tag fixture') returning id`,
    );
    const [quote] = await tx.execute<{ id: string }>(
      sql`insert into documents(organization_id,job_id,customer_id,type,status) values (${a.id},${job.id},${customer.id},'quote','draft') returning id`,
    );
    const [invoice] = await tx.execute<{ id: string }>(
      sql`insert into documents(organization_id,job_id,customer_id,type,status) values (${a.id},${job.id},${customer.id},'invoice','draft') returning id`,
    );
    const [red, blue, foreign] = await tx.execute<{ id: string }>(
      sql`insert into tags(organization_id,name,color) values (${a.id},'Priority','red'),(${a.id},'Follow up','blue'),(${b.id},'Foreign','green') returning id`,
    );
    check(
      !tagSchema.safeParse({ name: "  ", color: "red" }).success,
      "blank names rejected",
    );
    check(
      !tagSchema.safeParse({ name: "Test", color: "#bad" }).success,
      "unsupported colors rejected",
    );
    check(
      tagIds(`${red.id},${red.id},invalid`).length === 1,
      "filter IDs validated and deduplicated",
    );
    await assert.rejects(() =>
      tx.transaction((t) =>
        t.execute(
          sql`insert into tags(organization_id,name) values (${a.id},'priority')`,
        ),
      ),
    );
    check(true, "case-insensitive duplicate names rejected");
    for (const [entity, table, column, id] of [
      ["job", "jobs", "job_id", job.id],
      ["quote", "documents", "quote_id", quote.id],
      ["customer", "customers", "customer_id", customer.id],
    ] as const) {
      const find = async (filter: Parameters<typeof tagPredicate>[2]) =>
        (
          await tx.execute(
            sql`select id from ${sql.raw(table)} where id = ${id} and ${tagPredicate(a.id, entity as TagEntity, filter)}`,
          )
        ).length;
      check(
        (await find({ tagMode: "untagged" })) === 1,
        `${entity}: untagged includes empty record`,
      );
      await tx.execute(
        sql`insert into tag_assignments(organization_id,tag_id,${sql.raw(column)}) values (${a.id},${red.id},${id}) on conflict do nothing`,
      );
      await tx.execute(
        sql`insert into tag_assignments(organization_id,tag_id,${sql.raw(column)}) values (${a.id},${red.id},${id}) on conflict do nothing`,
      );
      check(
        (await find({ tags: `${red.id},${blue.id}`, tagMode: "any" })) === 1,
        `${entity}: any finds one match`,
      );
      check(
        (await find({ tags: `${red.id},${blue.id}`, tagMode: "all" })) === 0,
        `${entity}: all requires every tag`,
      );
      check(
        (await find({ tags: red.id, tagMode: "all" })) === 1,
        `${entity}: repeated assignment is idempotent`,
      );
      check(
        (await find({ tagMode: "untagged" })) === 0,
        `${entity}: tagged records excluded from untagged`,
      );
      check(
        (await find({ tags: foreign.id })) === 0,
        `${entity}: foreign filters cannot return local data`,
      );
      await assert.rejects(() =>
        tx.transaction((t) =>
          t.execute(
            sql`insert into tag_assignments(organization_id,tag_id,${sql.raw(column)}) values (${a.id},${foreign.id},${id})`,
          ),
        ),
      );
      await assert.rejects(() =>
        tx.transaction((t) =>
          t.execute(
            sql`insert into tag_assignments(organization_id,tag_id,${sql.raw(column)}) values (${b.id},${foreign.id},${id})`,
          ),
        ),
      );
      check(true, `${entity}: cross-organization tags and targets blocked`);
      await tx.execute(
        sql`insert into tag_assignments(organization_id,tag_id,${sql.raw(column)}) values (${a.id},${blue.id},${id})`,
      );
      check(
        (await find({ tags: `${red.id},${blue.id}`, tagMode: "all" })) === 1,
        `${entity}: all finds complete match`,
      );
    }
    await assert.rejects(() =>
      tx.transaction((t) =>
        t.execute(
          sql`insert into tag_assignments(organization_id,tag_id,quote_id) values (${a.id},${red.id},${invoice.id})`,
        ),
      ),
    );
    check(true, "non-quote documents cannot be tagged as quotes");
    await tx.execute(
      sql`update tags set name = 'Urgent', color = 'orange' where id = ${red.id}`,
    );
    check(
      (
        await tx.execute(
          sql`select id from tag_assignments where tag_id = ${red.id}`,
        )
      ).length === 3,
      "rename and recolor preserve assignments",
    );
    await tx.execute(sql`delete from tags where id = ${red.id}`);
    check(
      (
        await tx.execute(
          sql`select id from tag_assignments where tag_id = ${red.id}`,
        )
      ).length === 0,
      "deletion removes all assignments",
    );
    check(
      (await tx.execute(sql`select id from jobs where id = ${job.id}`))
        .length === 1,
      "deleting a tag preserves the record",
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await globalThis.__fsmDbPool?.end();
}
console.log(`${checks} tag checks passed; all fixtures rolled back.`);
