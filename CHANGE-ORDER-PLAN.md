# Change-order audit and implementation plan

September 16, 2026. The approved plan has been implemented. The original audit below records the starting state; see CHANGE-ORDER-WORKFLOW.md for the implementation, verification, and limitations.

## Original audit findings

1. **Creation is a non-persistent editor.** `app/(app)/jobs/[id]/change-orders/new/page.tsx` passes `autosave={false}` and no preview handler. The editor uses the quote-saving hook, so enabling autosave alone would save the wrong document type. Its “What changed” area is explanatory text, not an editable change description. The page checks for any contract, despite describing it as signed.
2. **No dedicated write workflow exists.** There are no change-order create/save/send/approve/decline operations or API routes. The database already has document numbering, change-order details, signed price deltas, schedule impact, parent-contract references, scope references, and freezing on approval. An old page comment still describes retired tables; implementation must use the current document model.
3. **Existing documents cannot be opened properly.** `lib/queries/job-documents.ts` sends change-order cards to the new-order page. The contract page lists amendments without links to their own detail views.
4. **Customer review is missing.** `lib/queries/share.ts` supports quotes, contracts, and invoices, and returns null for change orders. Signing primitives recognize change orders, but that is not a complete approval workflow. Sending, review, consent/signature, approval/decline, and state updates need to be connected.
5. **Downstream foundations already exist.** Contract totals, job totals, settlement, and final billing include approved changes. `currentAgreedScope` can fold additions, deletions, replacements, and allowance settlements into the contract. These should be reused and checked through the new workflow, not rebuilt.
6. **Billing needs targeted guards.** The invoice source lookup accepts a change-order document without explicitly checking its approval state. Overall agreed-total checks already exist, but source eligibility, deductions after billing, and concurrent approvals need specific coverage.

## Proposed implementation

### 1. Persist and reopen drafts

- Create changes from the job/contract, with an explicit signed-contract eligibility check.
- Add organization-scoped create, load, update, and draft-delete operations using the existing document tables.
- Reuse the editor with a dedicated change-order persistence adapter, correct statuses and numbering, and retry-safe saves.
- Add editable change description, price adjustment, and schedule impact. Support additions and deductions; represent removal/replacement against existing scope explicitly rather than pretending every change adds work.
- Add dedicated detail/edit routes and correct links from the job and contract.

### 2. Send and collect customer approval

- Preview the change, prior agreed amount, adjustment, resulting total, and schedule impact.
- Reuse the existing share-link, email, and signing infrastructure with a change-order customer page.
- Implement approval and decline. Approval records the required signatures/consent and updates status and approval time atomically.
- Lock approved content. Ensure the customer approves the exact version shown; define edits/resending and invalidate stale approval attempts.
- Handle expired/revoked links, retries, duplicate submissions, and changes approved concurrently on the same contract.

### 3. Connect scope, progress, and money

- Apply only approved changes to current scope and agreed totals; retain the original signed contract and amendment history.
- Make pending/approved/declined states visible and linkable from the job and contract.
- Connect the approved adjustment to the agreed billing policy, preserving issued invoices and existing payment history.
- Explicitly handle deductions that reduce the agreement below amounts already billed or paid, and changes after final billing. No automatic refund or invoice rewriting.
- Reuse existing notification events where supported; agree any new events before extending the separate notification work.

### 4. Verify the complete flow

- Create, reload, edit, send, open as customer, approve/decline, and reopen the immutable record.
- Cover additions, deductions, replacement/removal, schedule-only changes, and multiple successive changes.
- Verify agreed scope, contract/job totals, invoice eligibility, and final balance after approval; pending and declined changes must have no effect.
- Cover cross-organization access, mismatched parent/job, unsigned contract, stale content, expired links, duplicate submissions, concurrent approval, and already-billed deductions.
- Run existing document, signing, and billing checks alongside focused integration tests and narrow-screen browser checks.

## Design input requested during planning (since supplied)

Please provide the change-order flow/wireframes and relevant document/signing rules. Code comments refer to Flow 7/8 and Documents sections 6/8, but those source documents are not present in the repository.

Confirm these choices from the designs:

1. Are both contractor and customer signatures required, and should the contractor's stored signature apply automatically?
2. Does approved extra work become a separate invoice, a new/adjusted future billing phase, or part of the final balance?
3. What should happen for a deduction after invoicing/payment, and for changes after final billing?
4. What is the intended interaction for removing/replacing work and settling allowances, and for revising a sent or declined change?

Recommended starting point: follow the existing contract-signing experience, keep approval separate from payment collection, preserve issued invoices, and make any billing-schedule adjustment explicit. These are proposals, not implemented behavior.
