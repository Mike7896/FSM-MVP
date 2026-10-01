# Publishing a product release

Release notes live in `product_releases`. Customers see only published releases; the old example entries are not imported. Admin → Releases supports creating drafts, editing their changes, previewing the saved content, and publishing. Each version is unique (`major.minor.patch`) and links to `/release-notes#v0.1.0`, for example.

For each release:

1. Choose a version. Use patch for fixes, minor for compatible features, and major for breaking changes. Keep the version in `package.json` and `package-lock.json` in sync with `npm version <version> --no-git-tag-version`.
2. Create the matching draft in Admin → Releases. Describe customer-visible changes under New, Better, and Fixed. Drafts can be saved and edited as work progresses.
3. Run type checking and the checks relevant to the changes. Commit the implementation and version bump together.
4. Deploy and verify the release, then tag its commit `v<version>`. The release-version workflow checks that a pushed version tag matches the package and lockfile.
5. Publish the saved draft from Admin → Releases. Publication makes the entry visible to customers and activates their unread indicator. Published versions are immutable; use a new patch release for subsequent fixes or corrections.

Deployment order for this feature: apply `0042_product_updates.sql` through `npm run db:migrate` before deploying the app. The migration creates only the release and support-reply tables, enables RLS, and revokes direct client access. No release is published automatically.

# Support replies

Open a request in either the live dashboard or Admin → Support. The email composer shows the recipient and outgoing reply history. Sending through Resend marks the request answered after the provider accepts the message. This is provider acceptance, not a delivery receipt.

Configure `RESEND_API_KEY`, a verified `EMAIL_FROM`, and `SUPPORT_EMAIL`. Customer responses go to `SUPPORT_EMAIL`; inbound email synchronization is not part of this feature.

Each reply is saved before sending. Its ID is also the Resend idempotency key. Unconfirmed sends can be retried using the saved reply without changing its contents. Because Resend retains keys for 24 hours, the app blocks retries after 23 hours: check the provider log before composing a replacement. No automated check sends customer email.

Alert volumes and channel preferences are saved per browser under Admin → Live → Alert me for…. Each category has its own slider and test button; 0% mutes it.

## Verification

- `npm run typecheck`
- `npx tsx --env-file=.env.local scripts/product-updates-check.mts` (migration and data checks; rolls back every database change)
- `npx tsx --env-file=.env.local --conditions=react-server scripts/support-email-check.mts` (mocked transport; no email)

The retry window follows [Resend�s idempotency key retention](https://resend.com/docs/dashboard/emails/idempotency-keys).
