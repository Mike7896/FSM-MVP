// Sentry on the edge runtime. Nothing runs there today — the proxy is on
// Node.js — but anything moved to it later is covered, the same as the server.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://2e0175256f869bb28926593184b43e8b@o4512133744558080.ingest.us.sentry.io/4512133749473280",
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,
  sendDefaultPii: false,
});
