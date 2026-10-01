# Receipts, permits, inspections, and information requests

## Implemented

- **Receipts:** the job's Add a receipt page opens the device camera or a photo/PDF picker, uploads to private storage, saves the amount/vendor/date/description, and returns to Job money. Job money lists receipts and attachment links; existing spend calculations include them. Retrying the same save cannot count a receipt twice.
- **Permits:** create from the job's jurisdiction and edit permit type, number, status, puller, fees, dates, and scope on its detail page. The nested page checks both the permit and the job in its URL.
- **Inspections:** record an appointment, edit its dates, record pass/fail/cancellation, corrections, notes, and re-inspection fees. A passing result can clear its named job phase. A later non-cancelled inspection supersedes the earlier result for that phase.
- **Information requests:** Ask for info in the quote editor first saves the quote, then opens the composer. Questions and replies are also reachable from the sent-quote page. Add/remove questions, request photos, and share the existing quote link or email it using the existing email service. The customer replies on that link without an account; answers appear in request history and photos also enter the job's captures.

## Integration with concurrent work

Claude's customer quote approval, contract signing, shared invoice/payment components, deposit issuance, and notification implementation were re-read during this work. The information-request section is integrated into that updated shared-document page. Those systems were preserved; the audit is a historical snapshot, not their current status.

## Database and configuration

- Migrations `0020_confused_whistler.sql` and `0021_broken_eternity.sql` add information requests and their document index. They were applied to the configured database. Receipt and inspection functionality reuse existing tables.
- New request rows have row-level security. Anonymous clients cannot read them directly; customer access is through a live quote token carrying the reply permission. Revocation/expiry is checked for replies and uploads.
- Uploads use the existing private `job-attachments` bucket and server-only Supabase secret. The server verifies upload existence, file type/size, and the owning record's path before saving an attachment. Photos/PDFs are limited to 10 MB; a reply accepts up to three photos.
- Email uses the existing Resend configuration. Without it, link sharing works. If email fails, the saved request and its link remain available for retry.

## Deliberate limits

- Receipt details are entered manually. This implements camera/file attachment and saving, not OCR or offline capture.
- Scheduling records an appointment arranged with the authority; it does not book with a permitting agency.
- Inspection-to-phase association uses the existing phase-name field. If a phase is renamed, update the inspection's phase selection too.
- Inspection result notifications and information-response notifications were not added to the separately developed notification system.
- Subscription cancellation, trade-pack behavior, and billing-model changes are outside this batch.

## Checks

- `npm run field:check`: validation and boundary cases without external services.
- `npm run field:integration-check`: temporary confirmed test user and two isolated test organizations; exercises authenticated APIs, private uploads, anonymous replies, phase readiness, and server-rendered pages. It deletes its records/user/uploads in `finally`. It never explicitly sends email or charges a payment.
- `npm run typecheck` and `npm run lint`.

The integration checks require the local app at `http://127.0.0.1:3000`, or `FIELD_CHECK_BASE`, and the configured Supabase database/storage. Device camera hardware and real email delivery require a final check on the intended device/deployment.
