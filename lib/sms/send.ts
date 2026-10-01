import "server-only";

import { serverEnv } from "@/lib/env";

/**
 * Sending a text, through Twilio.
 *
 * A plain HTTPS call rather than the SDK, the way email talks to Resend: one
 * endpoint, one form body, and nothing else in the product talks to Twilio.
 *
 * **Texts are optional per deployment**, like email. `smsConfigured()` is what
 * Settings asks before offering them — a Text column whose boxes do nothing is
 * worse than one marked coming soon.
 *
 * Today texts only ever go to the contractor's own phone, about their own
 * business. Texting customers is a separate decision, with a separate consent
 * story, and this is not a door to it.
 */

export function smsConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
}

export class SmsNotConfiguredError extends Error {
  constructor() {
    super("Texts aren't set up on this server yet.");
    this.name = "SmsNotConfiguredError";
  }
}

/** A text is one segment's worth of news, not a letter. */
const MAX_LENGTH = 320;

export async function sendSms({
  to,
  body,
}: {
  /** E.164 — `+15551234567`. */
  to: string;
  body: string;
}): Promise<{ id: string }> {
  const env = serverEnv();
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) {
    throw new SmsNotConfiguredError();
  }

  const form = new URLSearchParams({
    To: to,
    Body: body.length > MAX_LENGTH ? `${body.slice(0, MAX_LENGTH - 1)}…` : body,
  });
  // A Messaging Service id and a phone number go in different fields.
  if (env.TWILIO_FROM.startsWith("MG")) form.set("MessagingServiceSid", env.TWILIO_FROM);
  else form.set("From", env.TWILIO_FROM);

  const auth = Buffer.from(
    `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`
  ).toString("base64");

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    }
  );

  const result = (await response.json().catch(() => null)) as {
    sid?: string;
    message?: string;
  } | null;

  if (!response.ok || !result?.sid) {
    throw new Error(
      result?.message ?? `The text service refused it (${response.status}).`
    );
  }

  return { id: result.sid };
}
