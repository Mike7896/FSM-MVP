import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { changeRequests, documents, shareLinks, jobs } from "@/lib/db/schema";
import { DocumentError } from "@/lib/documents/errors";
import { attachmentUrl, verifyAttachment } from "@/lib/field/storage";
import { notifyLater } from "@/lib/notifications";

export async function requestContext(token: string) {
  const [link] = await db.select({ link: shareLinks, doc: documents, demo: jobs.isDemo }).from(shareLinks).innerJoin(documents, eq(documents.id, shareLinks.documentId)).innerJoin(jobs, eq(jobs.id, documents.jobId)).where(eq(shareLinks.token, token));
  if (!link || link.demo || link.link.revokedAt || (link.link.expiresAt && link.link.expiresAt <= new Date()) || !link.link.scopes.includes("view")) throw new DocumentError("This link is no longer available.", "not_found");
  const [contract] = await db.select().from(documents).where(and(eq(documents.jobId, link.doc.jobId), eq(documents.organizationId, link.doc.organizationId), eq(documents.type, "contract"), eq(documents.status, "signed"))).orderBy(desc(documents.createdAt)).limit(1);
  if (!contract) throw new DocumentError("Changes can be requested after the contract is signed.", "invalid");
  return contract;
}

export async function reserveChangeRequest(token: string, id: string, upload: boolean) {
  const contract = await requestContext(token);
  await db.insert(changeRequests).values({ id, contractId: contract.id }).onConflictDoNothing();
  const [request] = upload
    ? await db.update(changeRequests).set({ uploadCount: sql`${changeRequests.uploadCount} + 1` }).where(and(eq(changeRequests.id, id), eq(changeRequests.contractId, contract.id), isNull(changeRequests.submittedAt), sql`${changeRequests.uploadCount} < 12`)).returning()
    : await db.select().from(changeRequests).where(and(eq(changeRequests.id, id), eq(changeRequests.contractId, contract.id)));
  if (!request) throw new DocumentError("This request is unavailable or its upload limit has been reached.");
  return { contract, request, prefix: `${contract.organizationId}/${contract.jobId}/change-requests/${id}` };
}

export async function submitChangeRequest(token: string, id: string, body: string, photoPaths: string[]) {
  const { prefix, contract } = await reserveChangeRequest(token, id, false);
  for (const path of photoPaths) await verifyAttachment(path, prefix, true);
  const result = await db.transaction(async tx => {
    const [live] = await tx.select().from(shareLinks).where(eq(shareLinks.token, token)).for("update");
    if (!live || live.revokedAt || (live.expiresAt && live.expiresAt <= new Date()) || !live.scopes.includes("view")) throw new DocumentError("This link is no longer available.", "not_found");
    const [row] = await tx.select().from(changeRequests).where(eq(changeRequests.id, id)).for("update");
    if (row.submittedAt) {
      if (row.body !== body || JSON.stringify(row.photoPaths) !== JSON.stringify(photoPaths)) throw new DocumentError("This request has already been sent.");
      return { id };
    }
    await tx.update(changeRequests).set({ body, photoPaths, submittedAt: new Date() }).where(eq(changeRequests.id, id));
    return { id };
  });
  notifyLater({ kind: "change.requested", organizationId: contract.organizationId, requestId: id });
  return result;
}

export async function listChangeRequests(jobId: string, organizationId: string) {
  const rows = await db.select({ request: changeRequests, contract: documents }).from(changeRequests).innerJoin(documents, eq(documents.id, changeRequests.contractId)).where(and(eq(documents.organizationId, organizationId), eq(documents.jobId, jobId))).orderBy(desc(changeRequests.createdAt));
  return Promise.all(rows.filter(r => r.request.submittedAt).map(async ({ request, contract }) => ({ ...request, photos: await Promise.all(request.photoPaths.map(path => attachmentUrl(path, `${organizationId}/${jobId}/change-requests/${request.id}`))), contractId: contract.id })));
}
