# Application launch acceptance audit — October 5, 2026

**Later implementation:** the [remaining-fixes report](launch-remaining-fixes-2026-10-05.md) records fixes and regression results for E05, E07, E09, E10, E12 and part of E06. The findings below preserve the original audit state.

## Decision

**Not yet a clean paid-launch sign-off.** The tested core quoting, signing, invoicing, and payment-ledger paths passed. Subscription reconciliation can still restore stale entitlements, and several billing/entitlement discrepancies are reproducible. Environment configuration is being handled separately by Claude; this report does not certify the new Supabase branches or Vercel deployment.

The earlier six fixes remain documented in [launch fixes](launch-fixes-2026-10-05.md). This pass adds tests, evidence, and a collection-test fixture correction; it does not fix the remaining application findings below. Concurrent admin/invitation work is outside this pass.

## Remaining findings and launch priority

| Priority | Finding | Evidence and impact | Suggested correction |
| --- | --- | --- | --- |
| P1 — fix before paid access | **E07: overlapping reconciliation restores stale access** | Actual reconciliation module and database, with controlled Stripe retrieve responses: the newer Pro snapshot projects first, then an older Starter snapshot overwrites it. Final access is Starter. Sequential webhook deduplication does not prevent separate event/return/sweep requests racing. | Serialize authoritative retrieval and projection, and review all direct projection callers. Add a concurrency regression that proves the final state remains current. |
| P2 — fix before discounted offers | **E09: membership total ignores discounts** | A real sandbox Starter subscription with a 50% ongoing coupon has an upcoming Stripe invoice of **$14.50**, while `currentBill` reports **$29.00**. This is incorrect display, not evidence of overcharging. | Distinguish catalog subtotal from the actual discounted recurring amount/next invoice; account for discount expiry. |
| P2 — fix for reliable Free enforcement | **E05: native print bypasses activation** | Browser Save as PDF produces a clean quote while the job has no activation and the output has no draft label. The application Print button is not the only print route. This run used an unactivated job; it did not exhaust three other jobs first. | Watermark unactivated previews and expose clean output only after the server activation boundary. |
| P2 — attachment integrity and quota | **E06: nonexistent files accepted; quota is check-only** | Random nonexistent storage path passes size validation; authenticated capture completion returns **201** for a photo never uploaded. Source checks compare existing usage with the limit, without incoming-byte reservation; homeowner reply uploads lack an organization quota check. No mass storage exhaustion was attempted. | Require object existence and valid metadata at completion, validate tenant/path ownership, and enforce incoming/concurrent capacity at a durable boundary. |
| P2 — pricing accuracy | **E10: ACH fee copy ignores release state** | Audited release state has the ACH application fee disabled, while pricing still states **0.2%, capped at $5**. The collection implementation follows the release switch. | Make fee copy reflect release state and distinguish Stripe processing charges from ServiceClerk fees. |
| P2 — analytics correctness | **E12: aging drops invoices and includes demo work** | With 1,001 unpaid $100 invoices, aging counts 1,000 and omits $100. Marking the fixture job as demo still leaves 1,000 invoices in aging, contrary to the analytics module's stated exclusion. | Aggregate all qualifying invoices in SQL and exclude demo jobs consistently. The volume cap is unlikely to affect the first testers; demo contamination can. |

Source locations: `lib/membership/reconcile.ts:110`, `lib/membership/bill.ts:73`, `app/(app)/quotes/[id]/view/page.tsx`, `lib/membership/storage.ts:44`, `app/(public)/pricing/page.tsx:77`, `lib/queries/analytics.ts:99`.

Additional source-reviewed discrepancies: the branding preset selection is not passed to `OfficeDocumentPreview`, so the stated immediate preview behavior is incomplete; the refund page says “first payment” while the guarantee implementation returns qualifying subscription payments within the initial window. These remain lower-priority corrections. The earlier activation fix protects usage after publication but is not an email outbox; exactly-once email delivery and all post-delivery history failures remain unproven.

## Browser acceptance

An isolated headless Edge browser exercised the local application at `http://localhost:3105`, with real Supabase fixtures and Stripe sandbox handoffs. A second anonymous context used a 390-pixel mobile viewport. **22 browser assertions passed**, with two additional checks reproducing known findings rather than passing acceptance.

- Annual pricing shows the full $290 Starter bill; the CTA carries the selected interval through login, welcome, Office creation, and checkout review.
- Signup rejects an empty submission; the Google entry carries purchase intent. The test account was created through Supabase admin and confirmed for testing, then logged in through the real UI. **Actual signup submission, confirmation-email delivery, and Google OAuth completion were not tested.**
- Real sandbox hosted subscription checkout opens with the selected Starter plan. **The browser did not submit a card or complete that checkout.** Separate server-side sandbox subscription/payment tests passed.
- Free Library shows the upgrade explanation. Billing, Connections, Branding, and Analytics routes render without server errors for the fixture account; this alone does not validate every paid-tier interaction.
- Anonymous homeowner quote shows the selling amount, with no fixture internal unit cost found in rendered text or serialized HTML. Mobile quote has no horizontal overflow. Approval records acceptance; revoking the original link removes access.
- Anonymous invoice shows $100 outstanding. Recording a **manual cash payment** through the real API changes the ledger balance to zero and the public invoice to Paid. The mobile unpaid/paid screenshots were visually checked. **This is not evidence of a homeowner card charge completing in the browser.**
- Connected-account setup creates a sandbox account and opens Stripe's hosted onboarding. **Identity/bank onboarding was not completed.** The disposable sandbox account was removed.
- No uncaught page JavaScript errors were observed.

[Browser results](launch-browser-evidence/results.json) · [unpaid mobile invoice](launch-browser-evidence/invoice-unpaid-mobile.png) · [paid mobile invoice](launch-browser-evidence/invoice-paid-mobile.png) · [mobile quote](launch-browser-evidence/homeowner-quote-mobile.png) · [unactivated PDF evidence](launch-browser-evidence/unactivated-quote.pdf).

## Integration and transport checks

| Suite | Result | Boundary exercised |
| --- | --- | --- |
| `billing-check.mts` | 7 checks passed | Database settlement behavior, rolled back |
| `signing-check.mts` | 34 passed | Signing consent, hashes, immutability, certificates |
| `quote-signing-check.mts` | 28 passed | Quote acceptance/signature, contract generation, repeated submission |
| `change-orders-check.mts` | 33 passed | Approval, hashes, adjusted contract sum, stale billing/deduction guards |
| `contract-send-check.mts` | 12 passed | Link-only send lifecycle, repeat sends, authorization negatives |
| `plan-check.ts` | 22 passed | Percentage deposits, phase allocation, rounding, tax arithmetic |
| `collection-check.mts` | 12 passed | Database-backed collection state, rail switching, retries, delayed events, refund deduplication; **Stripe transport stubbed** |
| `field-workflows-check.mjs` | 20 passed | HTTP receipts, idempotency, cross-tenant checks, inspection gates, homeowner requests/photos, anonymous RLS rejection, expired tokens |
| `stripe-check.mts` | 44 passed | Read-only actual sandbox product/price/portal configuration checks |
| `launch-webhook-check.mts` | 10 assertions passed; two findings reproduced | Signed local platform HTTP, signature expiry/tampering, duplicate receipt, real sandbox subscription reconciliation; controlled retrieval interleaving for the race |
| `launch-connect-webhook-check.mts` | 12 passed | Signed local Connect HTTP and real DB: unsigned/wrong/stale/tampered rejection, repeated event and repeated charge deduplication, tenant attribution, unknown account handling |

The collection suite needed its disposable fixture updated to include the joined `connections` record expected by the application. No runtime behavior was changed to make it pass.

Platform and Connect HTTP events were **locally signed synthetic events**, not deliveries from Stripe. Connect fee retrieval against a real balance transaction was not part of the synthetic transport test. Foreign invoice/job metadata remained unattributed money inside the connected account's own organization; it did not modify the other tenant's ledger.

[Platform results](launch-webhook-results.json) · [Connect results](launch-connect-webhook-results.json) · [storage/analytics reproductions](launch-remainder-results.json).

TypeScript validation and targeted ESLint passed after the audit additions. The full production build passed in the preceding fixes pass; it was not repeated for these test-only changes. Other agents' concurrent changes are not certified by these results.

## Environment handoff and remaining acceptance

Before the local Connect transport test, this checkout had no `STRIPE_CONNECT_WEBHOOK_SECRET`, and its endpoint returned 500. The audited Stripe sandbox listed no persistent webhook endpoints. A CLI listener could explain successful prior manual tests. These observations predate completion of Claude's environment setup and do not establish the state of all deployments.

For the transport test only, the audit server received a process-local synthetic Connect signing secret and `NEXT_PUBLIC_SITE_URL=http://localhost:3105`. No environment file or deployment setting was changed. The ordinary environment points to another local port, which initially broke the test's absolute approval return URL; correcting the audit server's process URL resolved that fixture mismatch.

Release acceptance still requires:

1. Verify the intended deployed app, database branch, Stripe account/mode, platform webhook, and Connect webhook are paired correctly. Observe provider-delivered successful events reaching the intended branch and a duplicate delivery leaving one payment.
2. Complete a real confirmation-email/Google-to-checkout acceptance path on the deployed URL. Confirm intended testers' invitation and grant behavior after the concurrent invitation changes.
3. Complete a homeowner sandbox card-payment flow and verify the paid public invoice and contractor ledger after actual provider delivery. Confirm connected onboarding/capabilities on the deployed environment. User-reported prior manual success is useful but does not certify the newly split environment.
4. Verify the membership sweep schedule and authenticated trigger configuration. The local endpoint rejected an unauthenticated request with 401; this audit did not trigger a sweep across shared users. No repository `vercel.json` proved scheduling at the time inspected.
5. Confirm observability and refund/tax configuration for the actual live account. The inspected sandbox's Tax status was pending with no registrations; that is an environment observation, not an assessment of tax obligations.

No production deployment, live charge, real-customer email, or shared release-flag change was performed. Disposable browser accounts, organizations, documents, sandbox customer/coupon/connected-account fixtures were cleaned up by their suites. The original attached entitlement specification remains unavailable, so the implementation catalog is still the provisional entitlement baseline.

## Reproduction

Run DB suites with `node --env-file=.env.local --conditions=react-server --import tsx scripts/<suite>.mts`. The browser script is `node scripts/launch-browser-check.mjs` and uses the bundled Playwright package (override `PLAYWRIGHT_PACKAGE` if needed). Both HTTP suites require the audit server on port 3105. The Connect suite also requires `LAUNCH_LOCAL_CONNECT_SECRET` to match that server's process-only signing secret and deliberately rejects a different database fingerprint.

These are disposable-fixture integration tools, not production monitoring. Review the current environment target before rerunning. The remainder and webhook reproduction scripts report known findings; a successful process exit does not mean those defects are resolved.
