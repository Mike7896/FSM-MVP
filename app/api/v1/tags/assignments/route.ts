import { z } from "zod";
import { sql } from "drizzle-orm";
import { requireCaller, requireOrg, requireSameOrigin } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { tagTarget } from "@/lib/queries/tags";
import { entitySchema } from "@/lib/tags";

// Individual idempotent changes avoid overwriting another teammate's tag selections.
export const PUT = handler(async (request) => {
  requireSameOrigin(request);
  const { organizationId } = await requireOrg(
    request,
    await requireCaller(request),
  );
  const { entity, recordId, tagId, assigned } = await readJson(
    request,
    z.object({
      entity: entitySchema,
      recordId: z.uuid(),
      tagId: z.uuid(),
      assigned: z.boolean(),
    }),
  );
  const { table, column } = tagTarget[entity];
  await db.transaction(async (tx) => {
    const target = await tx.execute(
      sql`select id from ${sql.raw(table)} where id = ${recordId} and organization_id = ${organizationId} ${entity === "quote" ? sql`and type = 'quote'` : sql``} for key share`,
    );
    const tag = await tx.execute(
      sql`select id from tags where id = ${tagId} and organization_id = ${organizationId} for key share`,
    );
    if (!target.length || !tag.length)
      throw new ApiError(
        "not_found",
        "That record or tag is no longer available.",
      );
    if (assigned)
      await tx.execute(
        sql`insert into tag_assignments (organization_id, tag_id, ${sql.raw(column)}) values (${organizationId}, ${tagId}, ${recordId}) on conflict do nothing`,
      );
    else
      await tx.execute(
        sql`delete from tag_assignments where organization_id = ${organizationId} and tag_id = ${tagId} and ${sql.raw(column)} = ${recordId}`,
      );
  });
  return ok({ assigned });
});
