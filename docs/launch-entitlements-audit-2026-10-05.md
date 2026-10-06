# Launch entitlement and billing audit — October 5, 2026

Implementation follow-up: the six prioritized findings E01, E02, E03, E04, E08, and E11 have been addressed in the working tree. See [fixes and verification](launch-fixes-2026-10-05.md). The original audit below records the pre-fix state; its other findings remain separate work.

Acceptance follow-up: see the [browser, integration, webhook, and remaining-findings report](launch-acceptance-audit-2026-10-05.md) for the later runtime evidence and current launch limitations.

Second implementation pass: [remaining fixes and regression results](launch-remaining-fixes-2026-10-05.md).

## Scope and conclusion

Source review of working tree at `760d1f4`: entitlement derivation, saved items, quote-view tracking, branding, activation, storage, subscription checkout and changes, reconciliation, pricing, checkout confirmation, account billing, and homepage claims. Existing admin dashboard changes were left untouched.

**The entitlement system is not consistently enforced across all reviewed entry points. Paid launch needs corrections.** The shared catalog and server-derived access model are a useful foundation, but individual endpoints and some customer-facing promises bypass or disagree with them.

The requested attached entitlement matrix was not available during this pass. This report uses `lib/membership/catalog.ts`, current implementations, and the September 29 audit as the provisional policy baseline. It does not certify conformity with the missing specification. Prior audit claims were checked against current source where discussed below.

This is a source audit, not a completed browser or live-environment acceptance test. No production subscriptions, charges, settings, or release switches were changed. No runtime application files were edited.

## Entitlement coverage

| Capability | Free / Starter / Pro in catalog | Reviewed enforcement | Assessment |
| --- | --- | --- | --- |
| New job activations | 3 per UTC month / unlimited / unlimited | `membership/activation.ts`, document send operations, collection | Ordinary sends use reservations; failure and print bypasses remain |
| Promotional footer | Yes / no / no | `documents/header.ts`, quote view | Snapshot generation applies the tier; document lifecycle needs runtime verification |
| Logo branding | No / no / yes | Branding write API, header capture, email letterhead | Server checks found; preset preview still incomplete |
| Quote-view tracking | No / no / yes | Timeline, dashboard, notification composer, quote list API | UI masking exists; API leaks view timestamp |
| Analytics | No / no / yes | Analytics page checks access | Page gated; aging aggregation truncates records |
| Saved items | No / yes / yes | Saved-item create/update APIs and Library page | Missing entitlement enforcement |
| Attachment storage | 1 / 10 / 25 GiB; displayed as GB | Signed upload checks and post-upload validation | Check-only quota; no incoming-byte reservation |
| Priority support | No / no / yes | `support/service.ts` | Ticket priority reads entitlement; service delivery not evaluated |
| Electrical | Paid add-on or 14-day evaluation | Checkout release guard and evaluation guard | Keep unreleased: content catalog still marks it `coming` |
| AI | Explicit release gate | Credit machinery exists | Homepage advertises a draft workflow not found in product code |
| Complimentary account | Effective Pro | `deriveAccess`, owner account policy | Supported; verify the tester's actual grant and expiry before onboarding |

## Findings

### E01 — P1: paid saved items are available to Free accounts

**Evidence:** `lib/membership/catalog.ts:238` makes `savedItems` false on Free. `app/api/v1/saved-items/route.ts:22` authenticates, resolves the organization, validates the payload, and directly inserts. The PATCH route similarly updates without checking the feature. `lib/queries/library.ts` and `/office/library` do not gate access. `requireOrg` validates organization membership, not the billing tier. A source search found no consumer of `features.savedItems`.

**Trigger:** A Free owner creates or edits a library entry through the normal UI or calls the API directly.

**Impact:** A paid feature is freely usable; the entitlement matrix has no effect on this workflow. The comparison table also retains a stale comment saying the editor has not shipped and omits the feature entirely.

**Correction:** Check access at the authoritative create/edit/use boundaries. Decide the downgrade behavior explicitly: retaining previously quoted rows and allowing export/deletion should not require a subscription. Define whether existing library entries remain readable or reusable after downgrade. Advertise the implemented feature on the intended tiers.

**Verification:** Free, restricted, and expired-comp accounts cannot create/edit paid entries; Starter, Pro, grace, and active-comp accounts follow the approved matrix. Direct API calls must match UI behavior. Existing quotes remain intact after downgrade.

### E02 — P2: quote-view tracking leaks through the quote list API

**Evidence:** `lib/queries/quotes.ts:107` selects `documents.viewedAt` and returns it unconditionally. `app/api/v1/quotes/route.ts:26` returns this result. The web quote list and timeline apply separate feature checks, so those checks do not protect this API.

**Trigger:** A Free or Starter user requests their quote list after a homeowner has opened a quote.

**Impact:** The Pro-only timestamp is available to a non-Pro account. This is an entitlement leak within the user's own organization, not evidence of cross-tenant disclosure.

**Correction:** Centralize tier-aware serialization for quote reads. Redact the timestamp and review whether a `viewed` status or status filter reveals the same paid signal.

**Verification:** Exercise list, detail, dashboard, timeline, and notifications on each tier, including after downgrade. Pro should regain historical views if that is the intended policy.

### E03 — P1: plan changes can discard a scheduled downgrade

**Evidence:** `lib/membership/changes.ts:270` releases the previous schedule before updating the subscription or creating its replacement at line 311. If payment is pending, restoration is best effort; the function returns before persisting the requested new scheduled configuration. The webhook reconciles Stripe state but does not reconstruct this missing intent.

**Trigger:** A shop has a scheduled downgrade and requests another change. A failure occurs after schedule release, or a combined immediate/renewal change requires payment that succeeds later.

**Impact:** The customer's requested renewal behavior can be lost, potentially leaving a more expensive renewal than intended. The per-shop operation lock prevents overlapping changes but does not recover a crashed multi-step operation.

**Correction:** Persist the desired transition before external effects. Reconcile release/update/schedule steps with durable progress and idempotency, including delayed payment completion.

**Verification:** Inject interruption after each Stripe operation. Retry without duplicate billing; confirm the desired next renewal survives. Include delayed successful payment on a mixed immediate/scheduled change. This September finding remains open in current source.

### E04 — P1: email delivery can succeed while activation is released

**Evidence:** `lib/documents/operations/send-quote.ts:214` sends email before the transaction that records the sent state. `lib/membership/activation.ts:295` marks `delivered` true only after the entire callback returns. If the post-email transaction throws, the wrapper releases the activation.

**Trigger:** Email succeeds; the following database write fails.

**Impact:** A homeowner has received a commercial document, but the job may not consume its Free allowance. Retry can deliver another email, and local sent state can disagree with delivery. A later legacy backfill cannot recover a missing `sentAt` record.

**Correction:** Commit publication and activation at a durable boundary, then deliver through a retryable outbox. Retain proof of an externally delivered document when recording later effects fails.

**Verification:** Force failure immediately after successful email delivery and during activation commit. Confirm one counted job and recoverable delivery. Also test hold expiry and UTC month rollover. This September finding remains open.

### E05 — P2: native printing bypasses Free activation

**Evidence:** `app/(app)/quotes/[id]/view/page.tsx` renders a customer-ready document on the server and places an activation-aware `PrintButton` beside it. Rendering the page does not reserve an activation. Browser-native printing does not need to click that button.

**Trigger:** A Free user with exhausted allowance opens another draft's view page and uses the browser Print command.

**Impact:** The pricing FAQ promises that generating a customer-ready PDF consumes an activation, but this path can produce one without the check.

**Correction:** Serve a visibly draft-marked preview until the job has passed server-side activation; generate the clean print/export version through the protected publication path. Preserve normal draft viewing.

**Verification:** Browser Print and Save as PDF on an unactivated fourth job cannot produce the same clean output as an activated job. Existing activated jobs remain printable after downgrade.

### E06 — P2: storage quota is not a hard limit

**Evidence:** `lib/membership/storage.ts:46` only checks whether current bytes already meet the limit. It neither considers incoming size nor reserves bytes. A single file can exceed the remaining allowance; concurrent signed uploads can all pass. At line 68, capture validation treats absent storage metadata as zero bytes.

**Trigger:** Upload a 20 MB file with 1 MB remaining, or request multiple upload URLs near the quota. Complete a capture against a missing object to exercise the second weakness.

**Impact:** Advertised storage allowances can be exceeded, and a capture can pass this size check without an uploaded file. Receipt validation is stronger: `field/storage.ts` verifies object existence, MIME, and size, so the missing-object issue is not attributed to every attachment path.

**Correction:** Reserve declared incoming bytes per organization, verify actual object existence/size at completion, and expire abandoned reservations. Define and enforce the policy for homeowner-submitted uploads, which use another upload path. Preserve downloads and document sends when over quota.

**Verification:** Near-limit single and concurrent uploads; missing/oversized objects; abandoned uploads; downgrade while over quota; homeowner upload policy.

### E07 — P2: overlapping reconciliation can overwrite a newer projection

**Evidence:** `lib/membership/reconcile.ts:111` retrieves Stripe state and writes its derived projection without a per-business lock covering the full operation. The platform webhook locks by event ID (`app/api/stripe/webhook/route.ts:80`), so different events can overlap.

**Trigger:** Two different events retrieve different subscription snapshots and finish their database writes in reverse order.

**Impact:** Effective plan, scheduled change, or payment standing can temporarily regress. Sequential stale-event tests do not cover this interleaving.

**Correction:** Serialize authoritative retrieve-and-project by business or use a revision-aware strategy. Coordinate with user-triggered reconciliation too.

**Verification:** Deterministically interleave two snapshots and assert that the final projection reflects current Stripe state. This September finding remains open.

### E08 — P2: public plan selection is lost during signup

**Evidence:** `components/billing/plan-picker.tsx` sends `plan`, `interval`, and optional `pack` to `/signup`. `app/(auth)/signup/page.tsx` reads only `trade` and passes `/welcome` as the next destination. The signup form does not retain the selected purchase configuration.

**Trigger:** Choose annual Pro or Starter plus Electrical from pricing, then sign up.

**Impact:** The paid-plan CTA starts ordinary onboarding and forgets the selection. A prospect must rediscover the purchase path and choose again.

**Correction:** Preserve a validated purchase intent through onboarding and authentication, then show the selected bill before payment. Never grant access from URL parameters.

**Verification:** Email confirmation, immediate email signup, and Google sign-in all retain the selection. Existing users and expired sessions have a defined continuation path.

### E09 — P2: billing displays list price as the customer's membership total

**Evidence:** Checkout allows promotion codes for non-founder purchases. `lib/membership/bill.ts` computes the account bill from catalog lookup prices. `components/billing/bill-card.tsx` labels it “Membership total”; it does not account for subscription discounts. Receipt amounts are separate actual payments.

**Trigger:** A customer uses a valid subscription promotion code.

**Impact:** Account billing can display a different recurring amount from the discounted bill without explaining why. Discount expiration is not shown either.

**Correction:** Show base price, active discount and duration, and the actual upcoming amount using authoritative subscription/invoice data. Label an unavailable estimate honestly. Keep tax treatment explicit.

**Verification:** Percentage and fixed discounts, once/repeating/ongoing discounts, expiry, founding restrictions, and actual receipt totals.

### E10 — P2: ACH fee disclosure ignores its release switch

**Evidence:** `app/(public)/pricing/page.tsx:77` always states a 0.2% ServiceClerk fee capped at $5. `lib/stripe/collect.ts:106` charges it only when `ach_application_fee` is enabled.

**Impact:** The public page describes a fee that may not be charged in the launch configuration. This is an overstatement of cost, not evidence of overcharging.

**Correction:** Drive fee disclosure from the same release state, with clear wording for a waived fee if that is the intended offer. Add an example such as the ServiceClerk component on a $1,000 ACH payment, and distinguish it from Stripe processing charges.

**Verification:** Compare page text and PaymentIntent fee calculation with the switch both off and on. Verify actual live Stripe charges separately; this review does not establish a universal processing rate.

### E11 — P1 for public claims: homepage advertises unavailable AI quote drafts

**Evidence:** `app/(public)/page.tsx:64` promises an AI-assisted draft. The catalog says AI is not sold until release, and `membership/credits.ts` says product callers are not connected yet. No quote-draft AI implementation was found in the searched product routes/components.

**Impact:** A new visitor is promised a workflow they cannot reach. The previous audit's removal of future-AI marketing is no longer true of this homepage.

**Correction:** Replace this block with a verified shipped workflow, such as change orders or phased billing. Keep speculative features out of the launch pitch.

**Verification:** Every homepage claim maps to a usable production workflow and, where relevant, names its required tier. Keep sample screenshots clearly labeled as samples.

### E12 — P2: Pro aging analytics omit invoices beyond the first 1,000

**Evidence:** `lib/queries/analytics.ts:99` requests only 1,000 invoices and aggregates that page.

**Impact:** Outstanding balances can be understated for larger histories. Unlikely for tomorrow's first tester, but a confirmed paid-feature correctness defect.

**Correction:** Aggregate all eligible balances in SQL or paginate completely.

**Verification:** More than 1,000 invoices, with unpaid older invoices beyond the first page; compare with authoritative ledger totals. This September finding remains open.

## Billing-page and marketing design assessment

These observations are based on source and content; desktop/mobile screenshots and keyboard interaction remain unverified in this pass.

**Preserve:** Shared price picker; annual total shown before monthly equivalent; explicit tax language; add-on totals; unchecked add-on default; clear Free limits; separate payment fees; no-card signup language; explicit cancellation, payment-pending, grace, and restricted states; accessible textual comparison markers; labeled sample job imagery.

**Correct before visual polish:** Preserve the plan through signup (E08), show real discounted cost (E09), align ACH disclosure (E10), remove the AI promise (E11), and accurately explain saved items (E01). Reword the refund card: it says “first payment” while the confirmation and refund operation cover membership payments within the eligible window. Present the same promise at each step.

**Branding:** The preset selector saves a value but does not pass the selected preset into `OfficeDocumentPreview`. Do not claim a live style preview until changing the selector visibly updates it and issued documents use the choice. Logo entitlement checks are separate and do exist.

**Pricing page:** Lead with who each plan is for and what a contractor can do on Free. Explain “activated job” once in ordinary language, including the UTC reset timing. Suppress empty comparison groups when Electrical is unavailable. Keep processing fees close enough to prices that a reader sees both before committing. Consider a compact worked cost example, with explicitly separate subscription and payment-processing components.

**Account billing:** Organize around the customer's questions: current entitlement, amount due/next charge, renewal date, pending change, and actions. A complimentary tester should clearly see the grant and its end conditions. Do not apply acquisition-page persuasion to cancellation or payment failure states.

**Homepage:** Make the initial headline/subhead more specific about quoting, deposits, change orders, and progress billing. Prefer a real product walkthrough for the launch audience. You have no broad customer proof yet; use the sample workflow and an honest independent-builder message without invented testimonials, user counts, or quantified savings.

## Operational checks still required

The repository has an authenticated accounts cron endpoint but no `vercel.json`; the comment's claimed hourly schedule is not proof of a deployed scheduler. Establish the actual invocation, auth, last-success visibility, and failure alerting. Membership standing derives from time without cron, but notices, reconciliation repair, and day-30 write-off still require execution.

Tomorrow's live configuration must be verified separately: correct environment-specific Stripe catalog; releases; restricted portal configuration; platform and Connect webhook delivery; required migrations; founding launch date/cap; and the actual paid-plan/Connect settings. Purchasing hosting/database plans does not prove any of those behaviors. Tax configuration should be verified against the business's chosen requirements; this audit makes no tax determination.

Keep Electrical and AI unavailable while their product workflows are incomplete. Verify complimentary Pro and expiry for the contractor tester rather than assuming tester status automatically grants paid features.

## Verification performed and next acceptance pass

| Check | This pass |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| Membership/Stripe scenario suites | Not run; these create DB fixtures and some alter shared release state or Stripe sandbox objects |
| Live charges / deployment | Not performed |
| Browser visual and interaction review | Not performed |
| Attached specification comparison | Pending document |

Do not reuse September's passing test counts as evidence for this checkout. Before running integration suites, establish a disposable/test target and inspect their shared-state effects.

Required acceptance scenarios after corrections:

1. Free: three distinct activated jobs; fourth refused; unlimited drafts; repeat sends and later invoices on an activated job allowed. Include concurrent last-slot sends and browser printing.
2. Starter: unlimited activations and saved items; no Pro tracking/branding/analytics through either UI or API.
3. Pro and complimentary Pro: all promised paid features, correct support priority, grant expiry, and storage limits.
4. Lifecycle: scheduled downgrade/cancellation, grace boundary, recovery payment, pending upgrade, refund, expired comp, and delayed/out-of-order/overlapping webhook processing.
5. Costs: monthly/annual, founding/public, packs, promotions, tax preview, renewal changes, refunds, fee switch off/on, and actual receipts.
6. Durability: fail after each external effect, retry, and assert both billing and entitlement state recover without extra charges or lost customer instructions.
7. Browser: homepage → pricing → signup → onboarding → selected checkout; desktop and mobile; unavailable tiers; payment failure; cancellation/refund confirmation; keyboard focus and screen-reader labels.

## Recommended order

First resolve public misrepresentation, plan-change durability, and send/activation durability. Close the saved-item and tracking API gaps and preserve paid intent through signup. Then correct pricing/billing discrepancies and storage enforcement. Complete the isolated lifecycle suite and browser review against the authoritative specification before describing this as a finished launch audit. The limited tester rollout can remain small while these checks are completed.
