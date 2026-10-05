// Sentry on the server (Node.js runtime). Loaded once per server instance by
// instrumentation.ts.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://2e0175256f869bb28926593184b43e8b@o4512133744558080.ingest.us.sentry.io/4512133749473280",

  // Which deploy an error came from — production, a preview, or someone's
  // machine — so local experiments never read as production trouble.
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  // Errors are always sent. Performance traces are sampled: every request in
  // development, one in ten in production, the same as the browser.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,

  // The signed-in user's id is attached where it's known (lib/observability
  // `identify`); never their address or request bodies.
  sendDefaultPii: false,
});
