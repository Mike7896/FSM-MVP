import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdminCaller } from "@/lib/admin/access";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { supportReplies, supportRequests } from "@/lib/db/schema";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { escapeHtml } from "@/lib/email/escape";
import { serverEnv } from "@/lib/env";

const inputSchema = z.object({ id: z.uuid(), body: z.string().trim().min(1).max(10000) });
function checkId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new ApiError("not_found", "Support request not found.");
}
export const GET = handlerWithParams<{ id: string }>(async (request, { id }) => {
  await requireAdminCaller(request);
  checkId(id);
  const replies = await db.select().from(supportReplies).where(eq(supportReplies.requestId, id)).orderBy(asc(supportReplies.createdAt));
  return ok({ replies, configured: emailConfigured() && Boolean(serverEnv().SUPPORT_EMAIL) });
});

export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const admin = await requireAdminCaller(request);
  checkId(id);
  const input = await readJson(request, inputSchema);
  const replyTo = serverEnv().SUPPORT_EMAIL;
  if (!emailConfigured() || !replyTo) throw new ApiError("invalid_request", "Configure RESEND_API_KEY and SUPPORT_EMAIL before sending support replies.");
  const [ticket] = await db.select().from(supportRequests).where(eq(supportRequests.id, id));
  if (!ticket) throw new ApiError("not_found", "Support request not found.");
  // Persist before contacting the provider. Retries always use this exact payload.
  await db.insert(supportReplies).values({ id: input.id, requestId: id, adminId: admin.userId, recipient: ticket.replyTo, replyTo, subject: `Re: [#${ticket.number}] ${ticket.subject}`, body: input.body }).onConflictDoNothing();
  const result = await db.transaction(async tx => {
    const [reply] = await tx.select().from(supportReplies).where(eq(supportReplies.id, input.id)).for("update");
    if (reply.requestId !== id || reply.body !== input.body) throw new ApiError("conflict", "This reply has already been saved with different content. Reload the conversation.");
    if (reply.sentAt) return reply;
    // Resend retains idempotency keys for 24h. Never retry an uncertain send outside that window.
    if (Date.now() - reply.createdAt.getTime() > 23 * 3_600_000) throw new ApiError("conflict", "This send is too old to retry safely. Check its delivery in Resend before composing another reply.");
    let sent: { id: string };
    try {
      sent = await sendEmail({ idempotencyKey: `support-reply/${reply.id}`, to: reply.recipient, replyTo: reply.replyTo, subject: reply.subject, text: reply.body, html: `<div style="white-space:pre-wrap;font-family:Arial,sans-serif;line-height:1.6">${escapeHtml(reply.body)}</div>`, fromName: "ServiceClerk Support" });
    } catch {
      throw new ApiError("internal", "The send could not be confirmed. Your reply is saved; retry this reply to check or complete the send.");
    }
    const [saved] = await tx.update(supportReplies).set({ providerId: sent.id, sentAt: new Date() }).where(eq(supportReplies.id, reply.id)).returning();
    await tx.update(supportRequests).set({ status: "answered", updatedAt: new Date() }).where(eq(supportRequests.id, id));
    return saved;
  });
  return ok(result);
});
