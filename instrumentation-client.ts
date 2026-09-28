import * as Sentry from "@sentry/nextjs";

/**
 * Browser-side Sentry. Runs before the app becomes interactive.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Session Replay. Sampled low for normal sessions, always on for errored
  // ones - that is where replays actually earn their keep.
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  sendDefaultPii: false,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NODE_ENV,
  debug: false,
});

/** Ties client-side navigations into Sentry tracing. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
