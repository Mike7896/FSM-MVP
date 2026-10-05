import "server-only";

import { readAccess } from "@/lib/membership/access";

import { and, count, desc, eq, gte } from "drizzle-orm";

import { db } from "@/lib/db";
import { organizations, profiles, supportRequests } from "@/lib/db/schema";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { escapeHtml } from "@/lib/email/escape";
import { serverEnv } from "@/lib/env";
import type { CreateSupportRequestInput } from "@/lib/schemas";

import { supportKind, type SupportRequestView } from "./types";
import { reportError } from "@/lib/observability";

/**
 * SUPPORT — what a contractor sends us, kept and passed on.
 *
 * **Kept first, passed on second.** The row is written before anything is
 * sent anywhere, so a request survives a missing email key, a Resend outage,
 * or Sentry being switched off. Then the support inbox is emailed, with the
 * sender as the reply-to — answering them is pressing Reply.
 *
 * Sentry gets it from the browser rather than from here, because only the
 * browser has the session replay that turns "it broke" into something we can
 * watch.
 */

export async function createSupportRequest(input: {
  organizationId: string | null;
  userId: string;
  replyTo: string;
  userAgent: string | null;
  request: CreateSupportRequestInput;
}): Promise<SupportRequestView & { emailed: boolean }> {
  // Pro's prioritized queue (Billing §2.2) — stamped when sent, not re-derived later.
  const priority = input.organizationId
    ? (await readAccess(input.organizationId)).features.prioritySupport
    : false;

  const [row] = await db
    .insert(supportRequests)
    .values({
      priority,
      organizationId: input.organizationId,
      userId: input.userId,
      kind: input.request.kind,
      subject: input.request.subject.trim(),
      body: input.request.body.trim(),
      replyTo: input.replyTo,
      page: input.request.page ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    })
    .returning();

  const emailed = await emailSupport(row.id).catch((error) => {
    // Saved either way; a failed email is a log line, not the sender's problem.
    reportError("[support] Support email failed", error);
    return false;
  });

  return { ...view(row), emailed };
}

/** Somebody's own requests, newest first. Nobody sees anyone else's. */
export async function listSupportRequests(userId: string, limit = 20): Promise<SupportRequestView[]> {
  const rows = await db
    .select()
    .from(supportRequests)
    .where(eq(supportRequests.userId, userId))
    .orderBy(desc(supportRequests.createdAt))
    .limit(limit);
  return rows.map(view);
}

/** How many they've sent in the last hour — for the limit. */
export async function sentInLastHour(userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(supportRequests)
    .where(
      and(
        eq(supportRequests.userId, userId),
        gte(supportRequests.createdAt, new Date(Date.now() - 3_600_000))
      )
    );
  return row?.n ?? 0;
}

/** The Sentry feedback event the browser filed it as, for finding one from the other. */
export async function linkSentryEvent(userId: string, requestId: string, sentryEventId: string) {
  const updated = await db
    .update(supportRequests)
    .set({ sentryEventId, updatedAt: new Date() })
    .where(and(eq(supportRequests.id, requestId), eq(supportRequests.userId, userId)))
    .returning({ id: supportRequests.id });
  return updated.length > 0;
}

/** Whether a request will reach a person's inbox on this server. */
export function supportInboxConfigured() {
  return Boolean(serverEnv().SUPPORT_EMAIL) && emailConfigured();
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

async function emailSupport(requestId: string): Promise<boolean> {
  const to = serverEnv().SUPPORT_EMAIL;
  if (!to || !emailConfigured()) return false;

  const [row] = await db
    .select({
      request: supportRequests,
      business: organizations.name,
      name: profiles.fullName,
    })
    .from(supportRequests)
    .leftJoin(organizations, eq(organizations.id, supportRequests.organizationId))
    .leftJoin(profiles, eq(profiles.id, supportRequests.userId))
    .where(eq(supportRequests.id, requestId))
    .limit(1);
  if (!row) return false;

  const { request } = row;
  const kind = supportKind(request.kind);
  const who = [row.name?.trim(), request.replyTo].filter(Boolean).join(" · ");
  const facts: [string, string | null][] = [
    ["From", who],
    ["Business", row.business],
    ["Page", request.page],
    ["Browser", request.userAgent],
  ];

  const text = [
    `${kind.short} #${request.number}: ${request.subject}`,
    "",
    request.body,
    "",
    ...facts.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`),
    "",
    "Reply to this email to answer them.",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, Segoe UI, sans-serif; font-size: 14px; line-height: 1.5; color: #111;">
      <p style="margin: 0 0 4px; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: .04em;">
        ${escapeHtml(kind.short)} #${request.number}
      </p>
      <h1 style="margin: 0 0 16px; font-size: 18px;">${escapeHtml(request.subject)}</h1>
      <p style="margin: 0 0 20px; white-space: pre-wrap;">${escapeHtml(request.body)}</p>
      <table style="border-collapse: collapse; font-size: 13px; color: #444;">
        ${facts
          .filter(([, value]) => value)
          .map(
            ([label, value]) =>
              `<tr><td style="padding: 2px 12px 2px 0; color: #888;">${label}</td><td style="padding: 2px 0;">${escapeHtml(value!)}</td></tr>`
          )
          .join("")}
      </table>
      <p style="margin: 20px 0 0; color: #888; font-size: 12px;">Reply to this email to answer them.</p>
    </div>`;

  await sendEmail({
    to,
    subject: `${request.priority ? "[Pro priority] " : ""}[${kind.short} #${request.number}] ${request.subject}${row.business ? ` — ${row.business}` : ""}`,
    text,
    html,
    replyTo: request.replyTo,
    fromName: "ServiceClerk Help",
  });

  await db
    .update(supportRequests)
    .set({ emailedAt: new Date() })
    .where(eq(supportRequests.id, requestId));
  return true;
}

function view(row: typeof supportRequests.$inferSelect): SupportRequestView {
  return {
    id: row.id,
    number: row.number ?? 0,
    kind: row.kind,
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
