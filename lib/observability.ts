import * as Sentry from "@sentry/nextjs";

/**
 * A failure the code caught — and somebody needs to see.
 *
 * Catching keeps the person on the other end safe: they get a clean answer and
 * their work isn't lost. But a caught error is invisible to Sentry, which only
 * sees what escapes. So every place that catches something it can't fix itself
 * reports it here: the same line to the console as before (Vercel's runtime
 * logs), and the error to Sentry, tagged with the area the message names.
 *
 * - `error` — what was caught. Left out, the message itself is reported.
 * - `level` — "warning" for what's expected now and then (an expired sign-in
 *   link, a webhook signature that didn't match) and only worth seeing when it
 *   piles up; "error" for everything else.
 * - `extra` — ids and the like. Kept out of the message, so one failure
 *   happening to many records is one Sentry issue, not hundreds.
 *
 * Never throws: reporting a failure must not become a second one.
 */
export function reportError(
  message: string,
  error?: unknown,
  { level = "error", extra }: { level?: "error" | "warning"; extra?: Record<string, unknown> } = {}
) {
  const log = level === "warning" ? console.warn : console.error;
  log(message, ...(error === undefined ? [] : [error]), ...(extra ? [extra] : []));

  try {
    const area = message.match(/^\[([^\]]+)\]/)?.[1] ?? "server";
    const context = { level, tags: { area }, extra: { ...extra, message } };
    if (error instanceof Error) Sentry.captureException(error, context);
    else if (error === undefined) Sentry.captureMessage(message, context);
    else Sentry.captureException(new Error(`${message} ${String(error)}`), context);
  } catch {
    // Sentry unavailable — the console line above still stands.
  }
}

/** `reportError` at warning level — expected now and then, worth seeing when it piles up. */
export function reportWarning(message: string, error?: unknown, extra?: Record<string, unknown>) {
  reportError(message, error, { level: "warning", extra });
}

/**
 * Who's signed in, for any error this request reports. The id only — never
 * the address — matching `sendDefaultPii: false`.
 */
export function identify(userId: string) {
  try {
    Sentry.setUser({ id: userId });
  } catch {
    // As above.
  }
}
