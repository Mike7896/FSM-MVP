# Billing audit and UI review

Reviewed September 28–29, 2026 against `ServiceClerk - Launch Billing Specification.md` in the product strategy vault. Work continued on `dev`; the interrupted implementation and earlier audit fixes are now in `de00733`. The final corrections described below are working-tree changes on that commit. No production deployment or live payment was performed.

## Result

The main billing model is implemented and the tested sandbox scenarios pass. This is **not a launch approval**: the outstanding issues below need resolution or an explicit specification change. Electrical remains unreleased pending its content, as requested. Future AI capabilities remain outside the marketed offering.

## Corrections made during the audit

- Refused a second concurrent activation reservation for the same job. Preserved the reservation after successful delivery if the final commit fails. Added legacy activation backfill migration `0038_backfill_job_activations.sql` and lazy recovery from earlier sent documents.
- Stopped active/trialing status alone from granting access after the paid-through date. Kept configured pack charges visible when access is restricted.
- Serialized invoice collection and recovered lost Stripe responses using persisted idempotency keys. Fresh intent retrieval blocks a second charge while a payment is processing or awaiting its ledger event; changing payment method cancels the old payable intent.
- Reconciled payment-intent events from current Stripe state. Refund totals now increase monotonically, and a late partial refund cannot overwrite the current attempt status. Application-fee refunds use cumulative principal and actual Stripe refunds; replay repairs a missing local ledger write.
- Recorded webhook completion only after successful processing. Retries can finish interrupted effects instead of being discarded by a premature event receipt.
- Made guarantee refunds resumable from a durable request; paginated invoice payments and reused previously completed Stripe refunds before consuming the guarantee.
- Serialized checkout creation, expired superseded open sessions, checked for existing subscriptions, and refused exhausted founder pricing instead of silently substituting a higher price.
- Required the restricted customer-portal configuration; removed the unsafe fallback to Stripe's default portal.
- Enforced the branding entitlement on writes and disabled unavailable branding saves. Printing now fails closed on activation API errors.
- Moved external-operation advisory locks onto a separate, bounded database pool. Nested operations reuse their lock connection; they do not consume the data connections their own work needs. Conflicting operations return a retryable conflict. Membership changes, checkout, refunds, and webhook processing use this helper.

## Design changes

Updated public pricing, the shared plan picker/comparison table, upgrade and checkout screens, account billing, plan changes, cancellation, pack pages, and electrician marketing copy. The pages now use consistent content widths, card spacing, clearer price hierarchy, shorter feature lists, and more explicit billing terms.

Removed advertising for saved items and branding colors that are not implemented. Unreleased Electrical marketing no longer claims delivered template content. Existing owners can still select and manage their pack. A current Pro customer is not presented with a highlighted Starter recommendation.

The mobile comparison table scrolls within its card; its absolutely positioned screen-reader labels are contained so they no longer widen the page. At a 390px viewport, the pricing document width measured 375px after the correction (the remainder is the scrollbar).

## Outstanding findings

### P1 — Plan changes are not durably recoverable across every Stripe step

`lib/membership/changes.ts`, `applyChangeLocked`, releases the existing schedule before updating the subscription or writing the replacement schedule. A crash or Stripe error between these steps can lose the customer's scheduled downgrade. On pending payment, restoration is best effort and logs failures. A combined immediate and renewal change also does not persist a durable instruction to apply its new renewal configuration after the pending payment later succeeds.

Persist the desired transition before external calls and reconcile each step idempotently. Add interruption tests between release/update/schedule creation and a combined change whose initial payment fails then succeeds. The passing standalone decline and renewal scenarios do not cover this combination.

### P1 — Some paid features promised by the specification are unfinished

`lib/membership/catalog.ts` defines paid `savedItems` entitlements, but no saved-manual-item/shop-preset implementation was found. `components/office/branding-form.tsx` stores a document preset, yet its displayed preview does not receive the selected preset; its “Updates as you pick” claim is incorrect. Branding colors are absent. Marketing omissions prevent selling these as finished, but do not fulfill the specification.

Finish these features before enabling the corresponding paid offering, or agree on a revised launch scope. Electrical content is deliberately deferred, not an audit implementation omission.

### P1 — Operational launch prerequisites remain unverified

The sandbox catalog check passed, but Stripe Tax reported pending readiness and no active registrations. This is a test-account observation, not a determination about tax obligations or live configuration.

`app/api/cron/accounts/route.ts` invokes the membership sweep, but no deployed scheduler was verified. Its comment still references `vercel.json`, which is absent. Notices, missed-event repair, and day-30 write-off require reliable invocation. Verify deployed platform and Connect webhook delivery/signatures, scheduler authentication and execution, migration application (including activation backfill), portal restrictions, and live tax configuration before enabling sales. A local build does not validate these operational settings.

### P1 — Publication and activation are not one durable transaction

`lib/membership/activation.ts` surrounds an external send callback with reservation/commit. The duplicate-reservation and failed-commit cases are improved, but this is not atomic with every publication/email side effect. A callback that publishes and then throws can release a reservation despite publication; reservations can also expire while work is in flight. The browser print button alone cannot enforce activation against native printing.

Tie activation to the durable publication boundary, retain an outbox/recovery record for subsequent delivery, and gate customer-ready document generation on the server. Test failures after publication and month-boundary/expired-reservation recovery.

### P2 — Concurrent subscription reconciliation can still overwrite a newer projection

`lib/membership/reconcile.ts` retrieves current Stripe state and then writes the projection without serializing the entire retrieve/write sequence per business. Different webhook IDs can run concurrently despite each event's own lock. Fresh retrieval prevents ordinary sequential stale-event replay but does not itself prevent overlapping snapshots from completing in reverse order.

Serialize authoritative reconciliation by business, or use a revision-aware projection strategy. Add an interleaved retrieval/write test; the existing out-of-order scenario is not proof of concurrency safety.

### P2 — Storage limits are checks rather than reservations

`lib/membership/storage.ts` checks existing bytes before issuing upload permission, without reserving the incoming bytes. Concurrent uploads can all pass and exceed the allowance. Its post-upload check treats an absent object/size as zero. Reserve declared bytes, verify the stored object exists and its actual size, and reconcile the reservation on completion/expiry.

### P2 — Open disputes do not set the collection attempt's disputed state

`app/api/stripe/connect/webhook/route.ts` records `charge.dispute.created` in the ledger, but only calls `onAttemptReversed` for a lost closed dispute. The new-payment guard in `lib/stripe/collect.ts` depends on the attempt's disputed status. Synchronize attempt state for open/won/lost disputes using fresh authoritative state, and test whether collecting the resulting balance is permitted at each stage. The current suite does not cover this lifecycle.

### P2 — Aging analytics silently truncate at 1,000 invoices

`lib/queries/analytics.ts`, `agingBalances`, requests only the first 1,000 invoices. Larger businesses can see understated outstanding balances. Aggregate in SQL or iterate all relevant invoices, with a regression fixture beyond the page limit, before advertising this as reliable paid analytics.

## Verification

| Check | Result |
| --- | --- |
| `npm run membership:check` | 75 passed, 0 failed |
| `npm run membership:scenarios` | 59 passed, 0 failed; Stripe sandbox/test-clock scenarios |
| `npm run stripe:check` | 44 passed, 0 failed; tax readiness caveat above |
| `npm run collection:check` | 12 passed; disposable DB fixtures, stubbed Stripe transport |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed, including production TypeScript compilation and page generation |

The collection suite covers intent reuse, payment-method switching, delayed processing/success events, stale failure events, lost responses, proportional/full fee refunds, repairing missed ledger writes, activation count, conflicting operations, and more concurrent/nested operations than the data pool size. It makes no Stripe charge.

The sandbox scenario suite ran before the final lock-pool refactor; the final collection suite and production build validate that refactor, but the complete sandbox scenario suite was not repeated afterward.

Browser review covered desktop pricing/billing/plan/cancellation/pack views and mobile pricing, billing, and cancellation. The final additional mobile plan-page navigation timed out, so that last view is not claimed as verified. Browser viewport override was reset. No subscription-changing action was submitted through the UI. Checkout for a new free account and production webhook delivery were not end-to-end browser-tested in this pass.

Build emitted an existing Sentry import deprecation warning (`withSentryConfig` should eventually move to `@sentry/nextjs/config`); it did not fail the build.
