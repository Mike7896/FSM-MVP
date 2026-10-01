import * as Sentry from "@sentry/nextjs";

import type { SupportKind, SupportRequestView } from "@/lib/support/types";

/**
 * Sending a request, from the browser — ours first, then Sentry's.
 *
 * **Our copy is the one that has to land.** It's saved, and the support inbox
 * emailed, before Sentry hears anything; if Sentry is switched off here or
 * blocked by an ad blocker, nothing is lost.
 *
 * **Sentry gets what only the browser has**: the recording of the last minute
 * on the page (with the text on screen blanked out — see the replay settings
 * in `instrumentation-client.ts`), a screenshot if one was added, and the crash
 * it's about when it came from an error screen. The two are then tied together
 * so either can be found from the other.
 */
export async function sendSupportRequest(input: {
  kind: SupportKind;
  subject: string;
  body: string;
  /** The page it's about, as a path. */
  page: string | null;
  /** Their name and address, for Sentry's feedback inbox. */
  name?: string | null;
  email?: string | null;
  includeReplay?: boolean;
  screenshot?: File | null;
  /** The Sentry error this is about, from an error screen. */
  associatedEventId?: string | null;
}): Promise<SupportRequestView & { emailed: boolean }> {
  const response = await fetch("/api/v1/support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: input.kind,
      subject: input.subject,
      body: input.body,
      page: input.page,
    }),
  });
  const result = (await response.json().catch(() => null)) as {
    data?: SupportRequestView & { emailed: boolean };
    error?: { message?: string };
  } | null;
  if (!response.ok || !result?.data) {
    throw new Error(result?.error?.message ?? "That didn't send. Try again in a moment.");
  }
  const saved = result.data;

  // Best effort from here on: the request is already safe.
  void toSentry(saved, input).catch(() => undefined);
  return saved;
}

async function toSentry(
  saved: SupportRequestView,
  input: Parameters<typeof sendSupportRequest>[0]
) {
  if (!Sentry.isEnabled()) return;

  const attachments = input.screenshot
    ? [
        {
          filename: input.screenshot.name || "screenshot.png",
          data: new Uint8Array(await input.screenshot.arrayBuffer()),
          contentType: input.screenshot.type || "image/png",
        },
      ]
    : undefined;

  const eventId = Sentry.captureFeedback(
    {
      message: `${input.subject}\n\n${input.body}`,
      name: input.name ?? undefined,
      email: input.email ?? undefined,
      url: input.page ? `${window.location.origin}${input.page}` : window.location.href,
      source: "help",
      associatedEventId: input.associatedEventId ?? undefined,
      tags: { kind: input.kind, request: saved.number },
    },
    { includeReplay: Boolean(input.includeReplay), attachments }
  );

  if (eventId) {
    await fetch(`/api/v1/support/${saved.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentryEventId: eventId }),
    });
  }
}
