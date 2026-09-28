import * as Sentry from "@sentry/nextjs";

/**
 * Runs once per server instance, before the first request is handled.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

/**
 * Reports errors thrown while rendering Server Components, Server Functions and
 * Route Handlers to Sentry. Next.js calls this when it captures a request error.
 */
export const onRequestError = Sentry.captureRequestError;
