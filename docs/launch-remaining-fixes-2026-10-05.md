# Remaining launch findings — implementation pass

This pass started with the subscription reconciliation race, then addressed billing accuracy, print activation, storage validation, fee copy, and aging. Changes are in the working tree; nothing was deployed. No migration or environment-file change was introduced. Claude's infrastructure work and concurrent admin/invitation work were preserved.

## Fixed

- **E07 — reconciliation race:** all projection goes through an organization-scoped advisory lock. The first Stripe retrieval only identifies the organization; an authoritative second retrieval occurs inside the lock and supplies every projection write. Lock contention fails with a retryable conflict rather than accepting stale state. Webhook failures remain retryable. `reconcileFrom` now treats its payload as an identifier and delegates to the same fresh retrieval, so it cannot bypass locking. The organization key also covers old/replacement subscription IDs sharing one billing account. The tradeoff is an extra Stripe retrieval per reconciliation.
- **E09 — misleading billing total:** the billing card shows Stripe's next-invoice **amount due estimate**, including discounts, credits and estimated tax. Catalog line prices and scheduled-plan prices are explicitly labeled before discounts and tax. If preview retrieval fails, the card identifies the subtotal and unavailable estimate instead of inventing an invoice amount. Navigation keeps a labeled catalog summary so every page load does not request an invoice preview. Refund guarantee text now consistently describes membership payments within the first 14 days rather than just the first payment.
- **E05 — native print bypass:** unactivated Free quote and contract previews are marked on the server with a print watermark. The Print button removes it only after the activation endpoint succeeds. The confirmed state survives reload through the activation record. Native print after a fourth-job activation refusal stays marked. This addresses ordinary print/PDF behavior, not deliberate editing of downloaded HTML or a screenshot.
- **E10 — ACH fee copy:** public pricing reads the same ACH fee release flag as collection. When the fee is disabled, it states that only Stripe's processing rate applies.
- **E12 — aging totals:** a SQL aggregate covers the complete eligible invoice set rather than the first UI page of 1,000 rows. Demo jobs, drafts, and voids are excluded. Payments, refunds and chargebacks feed the ledger sum; overpayments do not produce negative receivables. Due-date buckets use UTC dates.

## Partially fixed

**E06 — attachment integrity and quota:** capture completion now rejects missing objects, missing size metadata, nonpositive sizes and invalid sizes. Homeowner upload slots now use the same full-organization-quota guard as contractor uploads. Valid receipt and homeowner-photo workflows still pass.

**Hard quota enforcement remains open:** signed URLs do not reserve incoming bytes, so simultaneous uploads or a file larger than the remaining allowance can still overshoot. A durable reservation/finalization policy across signed URLs and Storage writes is still needed; this pass does not claim to solve it.

## Verification

- `reconciliation-race-check.mts`: seven checks passed using actual database advisory locks and a disposable sandbox subscription with controlled retrieval timing. Covers delayed older snapshot, same-subscription contention, different-subscription contention in one organization, retry after release, stale payload entry point, failure release, and repeated reconciliation nested inside the plan-change lock.
- `launch-webhook-check.mts`: signed local platform webhook and sandbox subscription checks passed; the older overlapping-retrieval reproducer now ends on **Pro**. A 50% discount produces **$14.50**, removing it restores **$29**, and a **$5 customer credit** reduces the next amount due to **$24**. Injected preview failure produces an unavailable estimate with a labeled catalog subtotal. Clearing a Stripe discount required the explicit empty-string parameter; the initial test's empty array left the discount attached and was corrected.
- `launch-browser-check.mjs`: **29 checks passed**, including unactivated native printing, successful print activation and reload, exhausted three-job allowance, fourth-job refusal and watermark retention, missing-file HTTP rejection, homeowner quote approval/revocation, and invoice/manual-payment balances. Both draft PDFs were checked by extracting their text; the first was also rendered and visually inspected. This does not add a completed browser card-payment or KYC-onboarding test.
- `launch-remainder-check.mts`: nonexistent object rejected; **1,001 / 1,001 invoices counted**, no dollars omitted; **zero demo invoices counted**; due-date boundaries, null due dates, drafts, voids, partial payment/refund and overpayment expectations passed.
- `field-workflows-check.mjs`: **20 checks passed**, including real small receipt/homeowner photo uploads, repeated submissions, and tenant checks. No email was sent.
- Prior protections: **11 launch database checks** and **10 launch rules checks** passed, including concurrent final-slot reservations, publication rollback, stale workers, and plan-transition interruption/recovery.
- TypeScript, targeted ESLint, `git diff --check`, and the production build passed. Next generated all 132 static pages successfully.

Evidence: [browser results](launch-browser-fix-evidence/results.json), [watermarked PDF](launch-browser-fix-evidence/unactivated-quote.pdf), [exhausted-allowance PDF](launch-browser-fix-evidence/exhausted-allowance-quote.pdf), [billing/webhook results](launch-webhook-fixed-results.json), [storage/aging results](launch-remainder-fixed-results.json). Original audit evidence remains in the earlier result files.

## Still required for release

Hard storage reservations, branding preset rendering/preview consistency, and broader email outbox recovery remain open. Deployed email/Google authentication, actual provider-delivered platform and Connect events, completed homeowner card payment, connected-account capabilities, and scheduled membership recovery still require acceptance against the newly configured environments. The local Connect secret used for synthetic testing was process-only; the new configuration is owned by the infrastructure work, not certified here.

All test users, organizations, documents and sandbox customer/coupon fixtures created by these suites were cleaned up. No real customer emails, live charges, shared release-switch changes, or production deployment were performed.
