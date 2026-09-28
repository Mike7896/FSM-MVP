import { and, eq } from "drizzle-orm";
import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { infoRequests } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { requireInfoQuote, infoRequestLink, listInfoRequests } from "@/lib/field/info-requests";
import { createInfoRequestSchema } from "@/lib/schemas/info-request";

export const GET = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  await requireInfoQuote(id, organizationId);
  return ok(await listInfoRequests(id));
});
export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const quote = await requireInfoQuote(id, organizationId);
  const body = await readJson(request, createInfoRequestSchema);
  await db.insert(infoRequests).values({ id: body.id, documentId: id, questions: body.questions, photoPrompt: body.photoPrompt || null, note: body.note || null }).onConflictDoNothing();
  const [saved] = await db.select().from(infoRequests).where(and(eq(infoRequests.id, body.id), eq(infoRequests.documentId, id)));
  if (!saved || JSON.stringify(saved.questions) !== JSON.stringify(body.questions) || (saved.photoPrompt ?? "") !== body.photoPrompt || (saved.note ?? "") !== body.note) throw new DomainError("A different request was already saved. Refresh to review it before creating another.");
  return ok({ id: saved.id, ...await infoRequestLink(quote) });
});
