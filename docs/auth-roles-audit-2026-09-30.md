# Roles and authentication audit — 2026-09-30

## Conclusion

The requested capabilities already exist. Keep the current two-level platform
permission model rather than adding a second role table or a custom password
store. Admin grants are explicit; contractor access is the default. Tester is
an account policy, not an additional permission role.

## Implementation evidence

| Requirement | Existing implementation |
| --- | --- |
| Platform admin / regular contractor | `lib/admin/access.ts` checks `platform_admins`; everyone without a grant or configured owner email is denied admin access. |
| Bootstrap the owner's account | `lib/admin/owners.ts` reads `ADMIN_EMAILS`; the admin guard persists the grant for database authorization. |
| Protect admin pages and controls | Admin layout and pages call `requireAdmin`; all current admin API handlers call `requireAdminCaller`. The latter verifies cookie or bearer credentials before checking the grant. |
| Manage admin access | Account details can grant or revoke access. Owners are protected and an admin cannot demote themselves. Organization owners/admins do not automatically become platform admins. |
| Email/password login | `/login` and `POST /api/v1/auth/sign-in`, using Supabase `signInWithPassword`. |
| Email/password registration | `/signup` and `POST /api/v1/auth/sign-up`. Public signup honors email confirmation. |
| Password recovery/change | Password-reset and password API routes; changes require the current password or a recent verified recovery/email-link session. |
| Create test accounts | `/admin/accounts` and `createTestAccount` create a confirmed Supabase user with a supplied or generated password and tester policy. No mail is sent by that creation path. |
| Test account controls | Complimentary plan, expiration, send cap, notes, suspension and replacement passwords are implemented. |
| Account separate from sign-in methods | `auth.users.id` is the stable account key; `auth.identities` contains providers. Profiles and account policies reference that key. Organizations and memberships hold business access. |

## Connected environment verification

Inspected the Supabase/database selected by local `.env.local`. These results
do not establish which environment variables or code version Vercel uses.

- Google and email authentication are enabled; public signup is enabled.
- Public email signup requires confirmation.
- Four accounts exist; three have passwords; one has a persisted admin grant.
- One owner email is configured locally and matches an existing admin account.
- No account is currently marked as a tester.
- Every auth account has an app profile.
- Profiles, organizations, memberships, admin grants and account policies
  have row-level security enabled. Admin grants and account policies have no
  authenticated-client write policies.

Nine database authorization checks passed using existing account IDs with
the authenticated database role and transaction-local JWT claims:

1. The configured owner has a persisted admin grant.
2. A contractor is not recognized as a platform admin.
3. A contractor cannot read admin grants.
4. A contractor cannot read admin events.
5. A contractor cannot grant themselves admin access.
6. A contractor cannot edit admin grants.
7. A contractor cannot delete admin grants.
8. A contractor cannot give themselves a complimentary plan.
9. The admin is recognized by database authorization.

The test transaction was rolled back. No accounts, credentials, grants or
policies were retained or changed by these checks. This was a code, settings
and database authorization audit; a fresh browser login, test-user creation,
and Google/password linking were not exercised end to end.

## Operational notes

- Set the owner's actual sign-in email in `ADMIN_EMAILS` on each deployment.
  Open `/admin`, then use Accounts to create password-based test users.
- Removing an address from `ADMIN_EMAILS` does not delete its existing grant.
  Another admin must revoke that grant if access should end.
- Test accounts can use reserved `example.invalid` addresses. They cannot
  receive recovery email; use the admin replacement-password control instead.
- An existing Google account can use the documented password-recovery flow to
  set its first password. Preserve the existing account ID rather than
  creating a separate account for the second sign-in method.
- There is no separate username login or general-purpose identity-linking UI.
  Email/password meets the requested test-account use case.

## Changes from this audit

Corrected outdated auth route references and owner-bootstrap documentation in
the README, environment example and environment schema comments. No runtime
authorization changes or database migrations were necessary for the requested
admin/contractor and email/password capabilities.
