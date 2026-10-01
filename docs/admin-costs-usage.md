# Admin costs and usage

`/admin/usage` is restricted to platform admins, including its read/write and live API routes at `/api/v1/admin/usage`. The database table denies all access to Supabase `anon` and `authenticated` roles; the authorized server uses its existing database connection. Writes and admin audit events share a transaction.

## Saved provider records

Vercel, Supabase and Resend start with no prices or limits. Add other providers as needed. Each record stores one observation: scope, plan, currency, billing dates (UTC, end exclusive), observation date, reported total cost, recurring fee and usage allowances. A new save replaces that provider's record. This is an operating overview, not an invoice archive.

Reported spend includes any recurring fees already billed. Recurring fees are displayed separately, never added to reported spend. The summary includes only records whose billing period contains today and groups currencies separately. Unknown costs are excluded and coverage is displayed. No assumed prices or plan quotas are included.

Usage and allowance must have matching units and periods. Headroom is limit minus usage, floored at zero, with excess shown separately. Zero is a real limit; blank means unknown. Select whether an allowance triggers overage billing, is a hard cap or is only a reference threshold. The scenario slider multiplies saved usage; it does not estimate charges or forecast month-end usage. Expired records remain visible with a warning and are excluded from the current summary.

## Optional server-only live connections

- `VERCEL_USAGE_API_TOKEN` and `VERCEL_USAGE_TEAM_ID`: token with billing access to the team. Uses Vercel's [FOCUS billing charges endpoint](https://vercel.com/docs/rest-api/billing/list-focus-billing-charges), reading JSON Lines for the current UTC calendar month. Shows team-wide billed costs and quantities grouped by SKU and unit. Data is daily and may lag; it may include other projects. Live readings are separate from saved totals, preventing duplicate counting. Included allowances remain manually configured.
- `RESEND_USAGE_API_KEY`: key with permission to read account usage. Falls back to `RESEND_API_KEY` if unset. Uses `GET /usage` as defined by Resend's [official OpenAPI schema](https://github.com/resend/resend-openapi/blob/main/resend.yaml). Shows daily/monthly email counts and limits with reset timestamps. Null daily limits mean no daily cap. A send-only key will report access unavailable. This endpoint does not provide invoice costs.
- Supabase: enter actual costs, included allowances and readings from the provider dashboard. No management API integration is assumed. Instantaneous database size is not equivalent to billable average storage or organization-level usage.

Secrets are read only on the server, never stored in provider records. Fetches have a 12-second timeout, no shared response cache, and independent error states. Refresh never replaces manually saved records.

## Database and validation

Apply `drizzle/0040_platform_usage.sql` through the deployment migration process. Its additive SQL is rerunnable. During local development it was applied directly without advancing the migration journal, because earlier migrations were still pending; the normal migration sequence remains intact.

Checks: `node --experimental-strip-types scripts/usage-check.mjs`, `npm run typecheck`, and ESLint on the affected files. Provider credentials and plan entitlements must be configured before actual remote usage can be verified.
