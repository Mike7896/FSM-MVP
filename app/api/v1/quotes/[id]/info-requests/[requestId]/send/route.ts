import { and, eq } from "drizzle-orm";
import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { infoRequests, organizations } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { infoRequestLink, requireInfoQuote } from "@/lib/field/info-requests";
import { deliverInfoRequestSchema } from "@/lib/schemas/info-request";
import { emailConfigured, sendEmail } from "@/lib/email/send";

export const POST = handlerWithParams<{ id: string; requestId: string }>(async (request, { id, requestId }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const quote = await requireInfoQuote(id, organizationId);
  const body = await readJson(request, deliverInfoRequestSchema);
  const [row] = await db.select().from(infoRequests).where(and(eq(infoRequests.id, requestId), eq(infoRequests.documentId, id)));
  if (!row) throw new DomainError("That request doesn't exist.", "not_found");
  const link = await infoRequestLink(quote);
  if (body.channel === "link") return ok({ ...link, emailed: false });
  const to = quote.demo ? caller.email : body.to;
  if (row.emailSentAt) return ok({ ...link, emailed: true, to: row.recipient });
  if (!emailConfigured()) return ok({ ...link, emailed: false, deliveryError: "Email isn't configured. Copy the link below instead." });
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId));
  const text = `${org?.name ?? "Your contractor"} needs a few details for ${quote.title ?? "your quote"}.\n\n${row.note ?? ""}\n\nAnswer here: ${link.url}`;
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  try {
    await sendEmail({ to, fromName: org?.name, replyTo: caller.email, subject: "A few details for your quote", text, html: `<p>${escape(text).replaceAll("\n", "<br>")}</p><p><a href="${escape(link.url)}">Answer the request</a></p>` });
  } catch {
    return ok({ ...link, emailed: false, deliveryError: "The request is saved, but the email didn't go out. Retry or copy the link below." });
  }
  await db.update(infoRequests).set({ emailSentAt: new Date(), recipient: to }).where(eq(infoRequests.id, row.id));
  return ok({ ...link, emailed: true, to });
});
