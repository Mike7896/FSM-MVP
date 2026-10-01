import "server-only";

import { serverEnv } from "@/lib/env";

/**
 * Sending an email, through Resend.
 *
 * A plain HTTPS call rather than the SDK: one endpoint, one JSON body, and
 * nothing else in the product talks to Resend.
 *
 * **Email is optional per deployment.** `emailConfigured()` is what the send
 * surfaces ask before offering it — a Send button that fails on a missing key
 * is worse than one that isn't there, and copying the link always works.
 */

export function emailConfigured(): boolean {
  return Boolean(serverEnv().RESEND_API_KEY);
}

export type OutboundEmail = {
  idempotencyKey?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Replies land with the contractor, never with us. */
  replyTo?: string | null;
  /** The name in front of the sending address — the business, not the product. */
  fromName?: string | null;
  /** Files that ride along — the document's PDF. */
  attachments?: { filename: string; content: Buffer }[];
};

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email isn't set up on this server yet. Copy the link instead.");
    this.name = "EmailNotConfiguredError";
  }
}

export async function sendEmail(message: OutboundEmail): Promise<{ id: string }> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY) throw new EmailNotConfiguredError();

  const address = addressOnly(env.EMAIL_FROM);
  const name = message.fromName ? displayName(message.fromName) : "";
  const from = name ? `${name} <${address}>` : address;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
    },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((file) => ({
              filename: file.filename,
              content: file.content.toString("base64"),
            })),
          }
        : {}),
    }),
  });

  const body = (await response.json().catch(() => null)) as {
    id?: string;
    message?: string;
  } | null;

  if (!response.ok || !body?.id) {
    throw new Error(
      body?.message ?? `The email service refused it (${response.status}).`
    );
  }

  return { id: body.id };
}

/** `Quotes <quotes@x.com>` → `quotes@x.com`; a bare address passes through. */
function addressOnly(from: string): string {
  return from.match(/<([^>]+)>/)?.[1]?.trim() ?? from.trim();
}

/**
 * A business name made safe to sit in a From header. Quotes, angle brackets
 * and line breaks would each let a name break out of the header it is in.
 */
function displayName(name: string): string {
  return name.replace(/["<>\r\n]/g, "").trim().slice(0, 80);
}
