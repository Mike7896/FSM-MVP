# Launch fixes — October 5, 2026

The six prioritized findings from the launch audit are implemented in the working tree. These changes are not deployed. Existing admin and complimentary-account work was preserved.

| Finding | Result |
| --- | --- |
| E01: saved items on Free | Server guards cover creation, editing, use, and library reads. Free retains existing quote content, deletion, and export; saved-item templates are now included in data export. The comparison table describes the paid feature. |
| E02: quote-view leak | List, detail, timeline, and status-filter behavior mask viewed status and timestamps without Pro tracking. Pro can regain historical tracking. |
| E03: lost renewal changes | A durable billing-event journal records the requested configuration before Stripe mutations. Requests, webhooks, and the membership sweep resume the transition using the same upgrade idempotency key. Schedule updates reuse the attached schedule. |
| E04: released activation after publication | A customer link and its activation commit together. Later delivery or recording failures cannot release that activation; validation failures before publication still release reservations. Retries count the job once. |
| E08: lost purchase selection | Validated plan, interval, and pack survive signup, email confirmation, login redirects, and welcome. New owners create their Office and proceed to the selected checkout for bill review. Redirects retain refreshed session cookies. |
| E11: unimplemented AI promise | Homepage AI-drafting copy was replaced with the implemented change-order workflow. |

## Stripe behavior verified

Stripe refuses schedule edits while a subscription update is pending. Upgrades with an existing scheduled renewal or cancellation therefore use `error_if_incomplete`: a declined payment leaves the current plan intact and restores the prior renewal choice. Ordinary upgrades without an earlier renewal choice may remain pending; their requested future configuration is retained in the journal and applied after payment.

Recovery stops rather than issuing a fresh uncertain charge after the safe idempotency window. Recovery past a promised renewal boundary reports a support-review error instead of moving the change to a later renewal. Billing error messages no longer claim that nothing was charged when the result is unknown.

## Verification

- `scripts/launch-rules-check.mts`: interruption checks before and after all 20 successful-path checkpoints and 12 pending-payment checkpoints; declined and expired payment; stale commands; terminal replay; purchase-intent validation; tracking redaction.
- `scripts/launch-db-check.mts`: 11 checks against disposable organization fixtures, including real entitlement reads, retained export, publication rollback, stale reservations, and concurrent final-slot reservations. Fixtures removed afterward.
- `scripts/launch-stripe-check.mts`: actual Stripe sandbox customer and test clock; declined upgrade restores prior annual renewal; delayed payment grants Pro; simulated lost schedule response recovers the requested annual renewal; one paid upgrade invoice; completed replay is inert. Test clock and customer removed afterward. Test-key guard prevents live execution.
- TypeScript, ESLint, and the production build passed. The build required permission for a TypeScript subprocess blocked by the Windows sandbox.
- Three HTTP checks against the local production build passed: selected purchase parameters survive the signed-out login redirect, signup includes the selected destination, and the homepage renders the implemented change-order claim. These do not substitute for completing email/Google authentication in a browser.

Run the scripts with `npx tsx`, adding `--env-file=.env.local --conditions=react-server` for the database and Stripe checks. They do not change shared release flags. No schema migration is introduced; the transition journal uses the existing billing-events table.

## Remaining launch acceptance

The subsequent [application acceptance audit](launch-acceptance-audit-2026-10-05.md) records browser and integration results, reproduced remaining findings, and the environment handoff. Its explicit limitations supersede the pending-check summary below where checks have since been completed.

The original audit's other findings remain open, including storage reservations, native printing, and additional pricing/billing discrepancies. This pass does not certify the whole launch.

Verify deployed Stripe platform/Connect webhooks and the authenticated membership sweep schedule. There is no repository `vercel.json` proving that cron is configured. Recovery requires webhook delivery, a retry, or sweep execution; prolonged outages crossing a renewal boundary require support review.

An actual signup/email/Google-to-checkout browser pass and live-environment payment smoke test remain necessary after configuration. No live charge, real customer email, or deployment was performed. The original attached entitlement specification is still unavailable, so the catalog remains the provisional policy baseline.

The activation fix protects usage accounting after publication; it is not a general email outbox and does not guarantee exactly-once email delivery or repair all post-delivery document-history failures.
