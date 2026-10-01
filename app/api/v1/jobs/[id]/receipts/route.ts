import { and, desc, eq } from "drizzle-orm";
import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { receipts } from "@/lib/db/schema";
import { requireFieldJob } from "@/lib/field/access";
import { verifyAttachment } from "@/lib/field/storage";
import { receiptSchema } from "@/lib/schemas/receipt";
import { DomainError } from "@/lib/errors";
export const GET = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  await requireFieldJob(id, organizationId);
  return ok(await db.select().from(receipts).where(eq(receipts.jobId, id)).orderBy(desc(receipts.capturedAt)));
});
export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  await requireFieldJob(id, organizationId);
  const body = await readJson(request, receiptSchema);
  if (body.storagePath) await verifyAttachment(body.storagePath, `${organizationId}/${id}/receipts`);
  await db.insert(receipts).values({
    id: body.id, jobId: id, vendor: body.vendor || null, amountCents: body.amountCents,
    description: body.description || null, purchasedOn: body.purchasedOn,
    imageUrl: body.storagePath, capturedBy: caller.userId,
  }).onConflictDoNothing();
  const [saved] = await db.select().from(receipts).where(and(eq(receipts.id, body.id), eq(receipts.jobId, id)));
  if (!saved || saved.capturedBy !== caller.userId || saved.amountCents !== body.amountCents || saved.imageUrl !== body.storagePath || (saved.vendor ?? "") !== body.vendor || (saved.description ?? "") !== body.description || saved.purchasedOn !== body.purchasedOn) {
    throw new DomainError("This receipt was already saved with different details. Refresh to review it.");
  }
  return ok({ id: saved.id });
});
