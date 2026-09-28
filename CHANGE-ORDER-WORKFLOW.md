# Change-order workflow

Implemented September 16, 2026, using User Journeys, User Flows (Flow 8), and Quote Document Structure supplied by Michel.

## Available now

- Create a change from a signed job contract. Save and reopen a numbered draft using the existing scope editor.
- Price additions, deductions, removals, replacements (remove the old work and add its replacement), and allowance settlements. Record schedule impact and tax.
- Existing job captures load alongside the editor. Scope edits autosave; use **Save & review change** to persist schedule and billing choices.
- The contractor signs and sends an immutable version, with a customer link and optional email delivery. The customer reviews the adjustment, prior total, resulting total, schedule impact, and billing choice, then approves or declines.
- Approval records both signatures and updates agreed job totals and current scope. Next-draw changes adjust unbilled phases; otherwise the final balance includes the change. Positive changes can instead create a separate supplemental invoice.
- Customers can request changes with optional photos from an existing job document link. Requests appear on the job's change-order page and can be opened as a priced draft. Sending a request never constitutes approval.
- Job and contract links open the actual change record. History retains pending, approved, and declined changes.

## Safeguards

Organization-scoped reads/writes, signed-contract eligibility, revision conflicts, immutable sent versions, signed-content hashes, consent checks, expired/revoked link checks, serialized approval and billing, duplicate approval/invoice protection, and revalidation of referenced scope at approval.

Deductions cannot reduce the agreement below billed or collected money. Added work after final invoicing requires supplemental billing. If final invoicing happens between sending and approval, approval requests a revised change with the appropriate billing choice. Issuing an invoice rechecks the current agreement.

## Database

Migration `drizzle/0024_change_order_workflow.sql` is applied to the configured development database. It adds customer requests, billing/tax/total snapshots, and freeze protection for the new fields. Apply this migration to other environments before deploying the code.

## Verification

- 29 change-order integration checks using isolated temporary organizations.
- 7 HTTP checks covering authenticated creation, access denial, stale saves, page rendering, sending, and customer review.
- Browser check using a temporary account: edit/save/reload retained description and schedule; customer approval persisted after reload. Approval controls fit the narrow browser panel.
- Existing document (63), signing (34), and billing (14) checks passed during implementation.
- Final TypeScript checking and targeted lint checks passed, including the capture-loading addition. Billing checks were rerun after the invoice concurrency fix and passed.

Run `npm run change-orders:check`. With the local app running, run `npm run change-orders:http-check`. These scripts create and clean up their own test records and require the existing development database configuration. The HTTP script also creates a temporary authentication user. Never run these against a production database.

## Boundaries

- Sent/declined changes are revised by creating another change order; there is no withdraw-and-replace shortcut yet. Draft deletion is available through the API.
- Schedule impact is recorded in the signed change; it does not automatically reschedule appointments.
- Customer request photos are accessible from the request history, separately from contractor job captures.
- Automatic refunds, credit notes, and rewriting issued invoices are outside this implementation.
- Actual email delivery and physical camera/photo uploads were not exercised in the final browser test. No messages were sent to real customers.
- No production deployment was performed.
