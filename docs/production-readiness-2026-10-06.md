# Production readiness audit — October 6, 2026

Target: https://getserviceclerk.com. This pass used read-only Stripe and database queries, public browser checks, and two correctly signed, deliberately ignored webhook events. No charges, account creation, configuration changes, or authorized cron sweeps were performed.

## Verified

- Production catalog preview requires zero changes. All 12 stored prices match live Stripe on ID, lookup key, amount, currency, and active state; no duplicate active lookup keys.
- Production has no stored Stripe customer, subscription, or connected-account references. The previously stale mappings are gone; this also means there is no live application payment lifecycle to inspect yet.
- Platform charges and payouts are enabled, details are submitted, and platform card and US ACH capabilities are active.
- Both live webhook endpoints are enabled, use the application's pinned API version, and include all required event types, including `customer.subscription.pending_update_expired`.
- Both deployed webhook routes accept signatures generated with the corresponding local production secret and return the expected ignored-event response. This does not exercise payment handlers.
- Fifteen actual Stripe catalog events have database receipts. None of the 77 sampled live events has pending webhooks. Missing receipts for other sampled events are not treated as failures: historical events may precede endpoint setup and not all event types are handled.
- Deployed Google sign-in redirects to the production Supabase project, supplies a production callback, and the provider redirects to Google's sign-in host. Login and callback completion were not performed.
- Home, pricing, signup, login, privacy, and terms return HTTP 200. Unauthenticated billing access redirects to login; the accounts cron rejects unauthenticated requests with HTTP 401.
- Ten public browser assertions pass: annual prices, ACH fee copy, plan selection, Google plan preservation, invalid-signup validation, absence of the known dev URL in inspected signup bundles, three mobile overflow checks, and absence of uncaught JavaScript errors. Mobile pricing and signup screenshots were inspected. The pricing comparison table scrolls inside its container.
- `vercel.json` contains sync and notification schedules every five minutes and accounts cleanup hourly. Actual Vercel cron registration and successful executions were not verified.
- The two added audit scripts pass ESLint. This pass changes no application runtime code.

## Configuration gap

Stripe Tax returns `pending`, with missing field `head_office`, and zero active registrations. Membership checkout calls `taxCalculationActive()` and currently passes `automatic_tax.enabled = false`. This is a configuration gap rather than a checkout crash: purchases can proceed without automatic tax calculation. Complete the head-office setting if automatic tax is intended, and configure applicable registrations based on the business's actual obligations. Do not assume merely activating Tax creates registrations.

## Remaining live acceptance

1. Confirm the Connect destination's event source in Stripe is connected accounts. Endpoint enumeration and signature probes do not prove this routing choice.
2. Onboard the first real contractor and verify that contractor's card and ACH capabilities, charges/payouts status, bank details, and outstanding requirements. Platform activation does not activate each contractor. Sandbox enforcement differs from live mode: https://docs.stripe.com/connect/account-capabilities.
3. Verify an authorized live subscription and a homeowner payment through completion, including webhook delivery, application state updates, and receipt/invoice results. This audit deliberately did not incur charges. ACH settlement is asynchronous; checkout completion alone does not establish successful settlement.
4. Inspect Vercel cron execution logs after deployment.

Public onboarding is ready for a limited contractor pilot based on the checks above. Successful live contractor payments and full authenticated workflows remain unverified in this pass. Earlier audit residuals (hard concurrent storage quota reservations, branding preview consistency, and email outbox work) remain outside this configuration check; this report does not mark them resolved.

## Evidence and reruns

- `stripe-live-readiness-results.json`: timestamped Stripe, database, auth redirect, and HTTP observations.
- `live-browser-evidence/results.json` and screenshots: public browser acceptance.
- `node scripts/stripe-live-readiness.mjs`: reads `.env.production`; observations require review and are not a blanket automated launch verdict.
- `node scripts/live-public-browser-check.mjs`: public browser checks; uses installed Edge and the bundled Playwright path, overridable with `PLAYWRIGHT_PACKAGE`. Reads `.env.local` only to identify the dev Supabase URL.

Both scripts leave secrets out of their result files. The live audit's ignored-event POSTs and OAuth-start request create no billing records or user accounts.
