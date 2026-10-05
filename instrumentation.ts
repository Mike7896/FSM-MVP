import * as Sentry from "@sentry/nextjs";

/**
 * Runs once per server instance, before the first request is handled.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Reports errors thrown while rendering Server Components, Server Functions and
 * Route Handlers to Sentry. Next.js calls this when it captures a request error.
 *
 * Only errors that escape reach it. The API wrapper, the webhooks and every
 * other place that catches a failure to answer cleanly report it themselves,
 * through lib/observability.
 */
export const onRequestError = Sentry.captureRequestError;
