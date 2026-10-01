import { asc, eq } from "drizzle-orm";
import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson, readQuery } from "@/lib/api/handler";
import { created, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { requireFieldPermit } from "@/lib/field/access";
import { createInspectionSchema } from "@/lib/schemas/permit";
import { z } from "zod";

export const GET = handler(async request => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const { permitId } = readQuery(request, z.object({ permitId: z.uuid() }));
  await requireFieldPermit(permitId, organizationId);
  return ok(await db.select().from(inspections).where(eq(inspections.permitId, permitId)).orderBy(asc(inspections.createdAt)));
});
export const POST = handler(async request => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, createInspectionSchema);
  const permit = await requireFieldPermit(body.permitId, organizationId);
  const [row] = await db.insert(inspections).values({ ...body, jobId: permit.jobId }).returning();
  return created(row, `/api/v1/inspections/${row.id}`);
});
