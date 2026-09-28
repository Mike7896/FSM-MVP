import "server-only";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, jobs, infoRequests, shareLinks, captureArtifacts } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { ensureShareLink } from "@/lib/documents/share-links";
import { attachmentUrl, verifyAttachment } from "./storage";
import { validateInfoAnswers, answerInfoRequestSchema } from "@/lib/schemas/info-request";
import type { z } from "zod";

export async function requireInfoQuote(id: string, organizationId: string) {
  const [quote] = await db.select({ id: documents.id, jobId: documents.jobId, customerId: documents.customerId, title: documents.title, demo: jobs.isDemo })
    .from(documents).innerJoin(jobs, eq(documents.jobId, jobs.id))
    .where(and(eq(documents.id, id), eq(documents.organizationId, organizationId), eq(documents.type, "quote"))).limit(1);
  if (!quote) throw new DomainError("That quote doesn't exist.", "not_found");
  return quote;
}

export async function infoRequestLink(quote: { id: string; jobId: string }) {
  return ensureShareLink(quote, ["view", "reply"]);
}

/** Checks the token on every read, upload and answer. Never accept a client org/job. */
export async function resolveInfoToken(token: string) {
  const [link] = await db.select({ documentId: documents.id, jobId: documents.jobId, organizationId: documents.organizationId, scopes: shareLinks.scopes })
    .from(shareLinks).innerJoin(documents, eq(shareLinks.documentId, documents.id))
    .where(and(eq(shareLinks.token, token), isNull(shareLinks.revokedAt), or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, new Date())), eq(documents.type, "quote"))).limit(1);
  if (!link || !link.scopes.includes("reply")) throw new DomainError("That request link is unavailable.", "not_found");
  return link;
}

export async function listInfoRequests(documentId: string) {
  const [document] = await db.select({ organizationId: documents.organizationId, jobId: documents.jobId }).from(documents).where(eq(documents.id, documentId));
  if (!document) return [];
  const rows = await db.select().from(infoRequests).where(eq(infoRequests.documentId, documentId)).orderBy(desc(infoRequests.createdAt));
  return Promise.all(rows.map(async row => ({
    id: row.id, questions: row.questions, photoPrompt: row.photoPrompt, note: row.note, answers: row.answers,
    createdAt: row.createdAt.toISOString(), answeredAt: row.answeredAt?.toISOString() ?? null,
    emailSentAt: row.emailSentAt?.toISOString() ?? null, recipient: row.recipient,
    photos: await Promise.all(row.photoPaths.map(async path => ({ url: await attachmentUrl(path, `${document.organizationId}/${document.jobId}/requests/${row.id}`) }))),
  })));
}
export type InfoRequestView = Awaited<ReturnType<typeof listInfoRequests>>[number];

export async function answerInfoRequest(token: string, requestId: string, input: z.infer<typeof answerInfoRequestSchema>) {
  const link = await resolveInfoToken(token);
  const [row] = await db.select().from(infoRequests).where(and(eq(infoRequests.id, requestId), eq(infoRequests.documentId, link.documentId)));
  if (!row) throw new DomainError("That request doesn't exist.", "not_found");
  const error = validateInfoAnswers(row.questions, input.answers, row.photoPrompt, input.photoPaths);
  if (error) throw new DomainError(error, "invalid");
  for (const path of input.photoPaths) await verifyAttachment(path, `${link.organizationId}/${link.jobId}/requests/${row.id}`, true);
  return db.transaction(async tx => {
    // Recheck revocation/expiry immediately before committing the reply.
    const [live] = await tx.select().from(shareLinks).where(and(eq(shareLinks.token, token), isNull(shareLinks.revokedAt), or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, new Date())))).for("update");
    if (!live?.scopes.includes("reply")) throw new DomainError("That request link is unavailable.", "not_found");
    const [locked] = await tx.select().from(infoRequests).where(eq(infoRequests.id, row.id)).for("update");
    if (locked.answeredAt) return { id: locked.id, alreadyAnswered: true };
    await tx.update(infoRequests).set({ answers: input.answers, photoPaths: input.photoPaths, answeredAt: new Date() }).where(eq(infoRequests.id, row.id));
    if (input.photoPaths.length) await tx.insert(captureArtifacts).values(input.photoPaths.map(path => ({
      jobId: link.jobId, kind: "photo" as const, fileUrl: path, body: row.photoPrompt, flag: "customer reply",
    })));
    return { id: row.id, alreadyAnswered: false };
  });
}

export async function reserveInfoUpload(token: string, requestId: string) {
  const link = await resolveInfoToken(token);
  const [request] = await db.update(infoRequests).set({ uploadCount: sql`${infoRequests.uploadCount} + 1` })
    .where(and(eq(infoRequests.id, requestId), eq(infoRequests.documentId, link.documentId), isNull(infoRequests.answeredAt), sql`${infoRequests.photoPrompt} is not null`, sql`${infoRequests.uploadCount} < 12`)).returning();
  if (!request) throw new DomainError("This request is closed or its upload limit was reached. Ask the contractor for a new request.");
  return `${link.organizationId}/${link.jobId}/requests/${request.id}`;
}
