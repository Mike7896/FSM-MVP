import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { tagIds, type Tag, type TagEntity, type TagFilter } from "@/lib/tags";

export const tagTarget = {
  job: { table: "jobs", column: "job_id" },
  quote: { table: "documents", column: "quote_id" },
  customer: { table: "customers", column: "customer_id" },
  task: { table: "tasks", column: "task_id" },
} as const;
export async function listTags(org: string): Promise<Tag[]> {
  return [
    ...(await db.execute<Tag>(
      sql`select id, name, color from tags where organization_id = ${org} order by lower(name)`,
    )),
  ];
}
export async function tagsForRecords(
  org: string,
  entity: TagEntity,
  ids: string[],
): Promise<Record<string, Tag[]>> {
  if (!ids.length) return {};
  const column = sql.raw(`a.${tagTarget[entity].column}`);
  const rows = await db.execute<Tag & { target: string }>(
    sql`select t.id, t.name, t.color, ${column} as target from tags t join tag_assignments a on a.tag_id = t.id where t.organization_id = ${org} and a.organization_id = ${org} and ${column} in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`,`,
    )}) order by lower(t.name)`,
  );
  const result: Record<string, Tag[]> = {};
  for (const row of rows)
    (result[row.target] ??= []).push({
      id: row.id,
      name: row.name,
      color: row.color,
    });
  return result;
}
/** Correlated predicate runs before pagination; only caller-proven organization data participates. */
export function tagPredicate(
  org: string,
  entity: TagEntity,
  filter?: TagFilter,
): SQL {
  const { table, column } = tagTarget[entity];
  const target = sql.raw(`a.${column} = "${table}"."id"`);
  if (filter?.tagMode === "untagged")
    return sql`not exists(select 1 from tag_assignments a where ${target} and a.organization_id = ${org})`;
  const ids = tagIds(filter?.tags);
  if (!ids.length) return filter?.tags ? sql`false` : sql`true`;
  const matching = sql`select count(*) from tag_assignments a where ${target} and a.organization_id = ${org} and a.tag_id in (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`,`,
  )})`;
  return filter?.tagMode === "all"
    ? sql`(${matching}) = ${ids.length}`
    : sql`(${matching}) > 0`;
}
