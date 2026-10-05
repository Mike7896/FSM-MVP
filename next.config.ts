import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

/**
 * The single Settings wing became three destinations — the Office, Settings and
 * Account (IA §5.3) — and these carry the old addresses to the new ones.
 *
 * They are worth keeping rather than deleting after a release. Two of the
 * moved routes are named as deep-link targets in the alert table (IA §3.4), a
 * license renewal email is the one alert that arrives days after it was sent,
 * and a permanent redirect costs a line.
 *
 * `/settings/appearance` is the one address that changed meaning rather than
 * moving: document appearance went to `/office/branding`, and app appearance
 * kept the name. It redirects to the Appearance section of the one Settings
 * screen, which is where somebody following an old link wanted to end up half
 * the time and is one scroll from the other half.
 */
const nextConfig: NextConfig = {
  // postgres.js and the Stripe SDK are Node-only; keep them external so the
  // bundler does not try to trace them into the server bundle.
  serverExternalPackages: ["postgres", "stripe"],

  async redirects() {
    const moved: Array<[string, string]> = [
      ["/settings/profile", "/office"],
      ["/settings/defaults", "/office/defaults"],
      ["/settings/licenses", "/office/licenses"],
      ["/settings/automations", "/office/automations"],
      ["/settings/packs", "/office/packs"],
      ["/settings/packs/:path*", "/office/packs/:path*"],
      ["/settings/connections", "/office/connections"],
      ["/settings/data", "/office/data"],
      ["/settings/billing", "/account/billing"],
      ["/settings/billing/:path*", "/account/billing/:path*"],
      // Settings turned out to be one screen (wireframe 94 · 56b), so the two
      // routes the IA names are anchors on it rather than pages of their own.
      ["/settings/appearance", "/settings#appearance"],
      ["/settings/notifications", "/settings#notifications"],
    ];

    return moved.map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }));
  },
};

export default withSentryConfig(nextConfig, {
 // For all available options, see:
 // https://www.npmjs.com/package/@sentry/webpack-plugin#options

 org: "mvl-software",

 project: "javascript-nextjs",

 // Only print logs for uploading source maps in CI
 silent: !process.env.CI,

 // For all available options, see:
 // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

 // Upload a larger set of source maps for prettier stack traces (increases build time)
 widenClientFileUpload: true,

 // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
 // This can increase your server load as well as your hosting bill.
 // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
 // side errors will fail.
 // tunnelRoute: "/monitoring",

 webpack: {
   // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
   // See the following for more information:
   // https://docs.sentry.io/product/crons/
   // https://vercel.com/docs/cron-jobs
   automaticVercelMonitors: true,

   // Tree-shaking options for reducing bundle size
   treeshake: {
     // Automatically tree-shake Sentry logger statements to reduce bundle size
     removeDebugLogging: true,
   },
 },
});
