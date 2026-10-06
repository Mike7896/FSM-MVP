# Production Stripe handoff — October 6, 2026

## Current verified state

- `.env.local`: dev Supabase branch, Stripe test keys, localhost URL. Keep it that way. Its Connect webhook secret is currently absent; that affects local Connect webhook testing, not the live endpoint.
- `.env.production`: main Supabase project, Stripe live keys, `https://getserviceclerk.com`, both webhook secrets present. Presence is not proof that each signing secret matches its endpoint.
- Live account read-only catalog preview succeeds: **16 actions** (4 products, 11 prices, 1 membership portal). No live products/prices were created by this task.
- Both live endpoint URLs are enabled, use `2026-07-29.dahlia`, and list the events below except **`customer.subscription.pending_update_expired` is missing from the platform endpoint**. Add it in Workbench. Confirm the Connect endpoint's event source in the Dashboard; the API listing used here did not prove that selection.
- **Before applying the catalog:** production contains 11 price IDs, one customer ID, and one subscription ID unavailable under the live key. There are two connected-account rows; the first lookup failed with `account_invalid`, so verification stopped before certifying the other. These mappings must be reviewed as sandbox-era data. Do not delete contractor jobs, documents or ledger history as part of a blanket reset. The setup command refuses these mappings before apply or sync.

## Webhooks: edit or recreate only if needed

1. Open the ServiceClerk Stripe account in live mode, then **Workbench → Webhooks**.
2. Edit the existing platform destination (or **Create an event destination** if absent).
3. Choose **Your account**, **snapshot events**, API version **2026-07-29.dahlia** to match the installed SDK and handlers. Do not upgrade the webhook payload independently of the application.
4. Use `https://getserviceclerk.com/api/stripe/webhook` and the platform list below.
5. Save. Put that destination's signing secret in `STRIPE_WEBHOOK_SECRET` in Vercel **Production** and `.env.production`.
6. For the Connect destination, choose **Connected accounts** / **Connected and v2 accounts**, with **snapshot events** and the same API version. Use `https://getserviceclerk.com/api/stripe/connect/webhook` and the Connect list below. These handlers consume v1 snapshot event names even though account creation uses Accounts v2.
7. Put the Connect destination's separate signing secret in `STRIPE_CONNECT_WEBHOOK_SECRET` in Vercel **Production** and `.env.production`.
8. Redeploy the current code with the completed variables. Confirm Stripe deliveries get HTTP 200, not redirects, login/protection pages, signature errors or server errors. Do not use the local Stripe CLI listener's secret for a deployed endpoint.

[Stripe webhook instructions](https://docs.stripe.com/webhooks).

Platform events:

```text
checkout.session.completed
checkout.session.expired
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
customer.subscription.pending_update_applied
customer.subscription.pending_update_expired
subscription_schedule.created
subscription_schedule.updated
subscription_schedule.released
subscription_schedule.canceled
subscription_schedule.completed
subscription_schedule.aborted
invoice.paid
invoice.payment_failed
invoice.payment_action_required
product.created
product.updated
product.deleted
price.created
price.updated
price.deleted
```

Connect events:

```text
account.updated
charge.succeeded
charge.refunded
charge.dispute.created
charge.dispute.closed
payout.paid
payment_intent.processing
payment_intent.succeeded
payment_intent.payment_failed
payment_intent.canceled
```

## Catalog commands

Run from the repository root. The default command only reads live Stripe and prints a plan:

```powershell
npm run stripe:catalog:production
```

After sandbox-era production mappings are reviewed and resolved, apply using the account ID printed above and your production Supabase project reference:

```powershell
npm run stripe:catalog:production -- --apply --account acct_1U6J0MIlq4Cs7g4R --project-ref ktwxjcvvikbmlzeerled
```

Then mirror the live catalog into the production database:

```powershell
npm run stripe:catalog:production -- --sync --account acct_1U6J0MIlq4Cs7g4R --project-ref ktwxjcvvikbmlzeerled
```

If PowerShell/npm strips forwarded flags, use `node --conditions=react-server --import tsx scripts/stripe-production.mts` followed by the same flags.

The command reads `.env.production` explicitly, accepts only live Stripe keys, verifies the Stripe account and Supabase target before writes, reuses matching catalog entries, refuses silent repricing, and preserves existing customer/document data. It does not create connected accounts, subscriptions, payments, webhook destinations or tax registrations. Unreleased Electrical/AI catalog entries do not turn their application release flags on.

Validation: TypeScript, offline catalog tests and read-only live preview were exercised. The offline suite covers write-free planning, retry as a no-op, mismatched price rejection, unrelated fixed product IDs, portal repair, and duplicate portal rejection. Apply and sync have not been executed against live services.

## Connect manual checklist

- Complete any remaining **Connect platform profile/activation** requirements in live mode, in addition to ordinary business identity verification. Acknowledge the negative-balance responsibility model if Stripe requests it.
- Confirm the platform is configured for independent businesses accepting **direct charges**, with the contractor as the merchant. The code creates US/USD merchant accounts with a **full Stripe Dashboard**, `fees_collector: stripe` and `losses_collector: stripe`. These are already specified in account-creation code; do not manually create Express accounts to substitute for them. [Account behavior configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration).
- Set live **Connect onboarding branding**, platform name, support contact, website, privacy policy and terms URLs where Stripe requests them. Use `https://getserviceclerk.com/legal/privacy` and `/legal/terms` if these are your approved published policies.
- Confirm card payments and **ACH Direct Debit** are available for your live Connect setup. The app requests both capabilities, but Stripe/contractor requirements determine activation.
- Have each contractor use **Office → Connections → Set up payments**. They provide legal/identity information and their own payout bank account on Stripe's hosted onboarding. Confirm payments and payouts are enabled and outstanding requirements are resolved. The platform owner's payout account does not configure contractor payouts. [Hosted onboarding](https://docs.stripe.com/connect/hosted-onboarding).
- Verify the live Connect event source and successful `account.updated` / payment-event deliveries. A completed browser redirect alone does not establish payment readiness.
- Hosted onboarding return/refresh URLs are generated by the app from `NEXT_PUBLIC_SITE_URL`; no OAuth client ID is required for this account-creation path. Existing-account OAuth is a separate integration, not a prerequisite here.

Separately, confirm your membership billing's live Tax configuration and applicable registrations with your tax adviser, customer-portal legal/business details, and scheduled recovery jobs. The catalog script supplies a SaaS product tax code; it does not establish tax registrations or regulatory obligations.

Merging/deploying the code is distinct from accepting real payments. Finish the mapping transition, catalog sync and deployed end-to-end acceptance before treating the launch as signed off.
