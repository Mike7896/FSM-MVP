# ServiceClerk

Job management for the trades. Next.js 16 (App Router, Turbopack) on
Supabase, with Drizzle as the query layer and Stripe for billing.

## Stack and the division of labour

| Concern              | Tool                        | Notes                                              |
| -------------------- | --------------------------- | -------------------------------------------------- |
| Database queries     | **Drizzle ORM**             | All application data. Not the Supabase JS client.  |
| Schema + migrations  | **drizzle-kit**             | `drizzle/` holds the migration history.            |
| Auth                 | **Supabase Auth** (`@supabase/ssr`) | Cookie sessions, refreshed in `proxy.ts`.  |
| File storage         | **Supabase Storage**        | `lib/supabase/storage.ts`.                         |
| Subscriptions        | **Stripe**                  | Us charging the contractor. Stripe is the source of truth; we hold a read-model. |
| Taking payments      | **Stripe Connect**          | The contractor charging a homeowner. Direct charges on an account we create. |
| Money that moved     | **`ledger_entries`**        | Append-only, cash-only. Documents say what is owed; this says what moved. |
| UI                   | **shadcn/ui** (Radix base, `radix-nova`) | Tailwind v4.                          |
| Errors / performance | **Sentry**                  | `instrumentation.ts` + `instrumentation-client.ts`. |

The split to keep in mind: **Supabase JS is used for auth and storage only.**
Everything that reads or writes business data goes through Drizzle.

## Getting started

```bash
npm install
```

Copy the env template and fill it in:

```bash
cp .env.example .env.local
```

Every value in `.env.example` is annotated with where to find it. The app
validates env at import time (`lib/env.ts`), so a missing variable fails
immediately with a message naming it rather than surfacing as a null later.

The Supabase keys are the current **publishable** (`sb_publishable_...`) and
**secret** (`sb_secret_...`) keys, not the legacy `anon` / `service_role` JWTs —
so the env vars are `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
`SUPABASE_SECRET_KEY`. Older Supabase tutorials will name the JWT ones; the SDK
takes whichever you pass positionally, so the variable names are ours to choose
and these match what the dashboard now issues.

Then apply the schema and start the dev server:

```bash
npm run db:migrate
```

```bash
npm run dev
```

## Database and migrations

Schema lives in `lib/db/schema/`. After changing it:

```bash
npm run db:generate
```

```bash
npm run db:migrate
```

Other scripts: `npm run db:studio` (browse data), `npm run db:push` (skip the
migration file — dev only, never against production).

**One manual step after `db:generate`.** Our tables declare real foreign keys
into `auth.users`, so drizzle-kit emits DDL to create the `auth` schema and
table. Supabase owns both (`auth` is owned by `supabase_admin`), so that DDL has
to be neutralised by hand in the generated file.

`CREATE SCHEMA` is easy — add `IF NOT EXISTS`:

```sql
CREATE SCHEMA IF NOT EXISTS "auth";
```

`CREATE TABLE` is the trap. **`IF NOT EXISTS` is not enough**: Postgres checks
CREATE privilege on the schema *before* the existence check, and the `postgres`
role Supabase issues has USAGE but not CREATE on `auth`. You get
`42501 permission denied for schema auth` and the whole migration rolls back.
Guard it so the CREATE never executes on Supabase:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users'
  ) THEN
    CREATE TABLE "auth"."users" ("id" uuid PRIMARY KEY NOT NULL);
  END IF;
END $$;
```

`drizzle/0000_init.sql` has this applied — copy the pattern. It is a no-op on a
real project while still creating the stub on a bare Postgres, so the foreign
keys resolve either way.

**Reading migration failures.** `drizzle-kit migrate` exits non-zero but prints
the Postgres NOTICEs rather than the error that actually killed it, so a failed
run can look like it merely warned. Trust the exit code, and confirm against the
database. NOTICEs like `schema "auth" already exists, skipping` or
`trigger ... does not exist, skipping` are expected — they are the `IF NOT
EXISTS` and `DROP ... IF EXISTS` guards doing their job.

`drizzle/0001_rls_policies_and_triggers.sql` is hand-written and holds
everything drizzle-kit cannot express: RLS policies, the `handle_new_user`
trigger that creates a profile row, `updated_at` triggers, per-organization job
numbering, and the Storage buckets and their policies.

### Why authorization lives in the app, not only in RLS

Drizzle connects over the Postgres connection string as the `postgres` role,
which **bypasses RLS**. So the policies in `0001` are not what protects a
Drizzle query — they are defence in depth for anything that arrives via
PostgREST, the Supabase client, or a leaked publishable key.

The real boundary is `lib/dal.ts`. Every query that touches tenant data must
either go through a function there or be scoped by an organization id that was
checked against a membership first. `requireMembership()` is the function to
reach for whenever an organization id came from user input — a route param, a
form field, a query string.

## Auth

Two layers, deliberately:

- **`proxy.ts`** — refreshes the session cookie on every request and does an
  *optimistic* redirect based on the cookie alone. Cheap, runs everywhere, and
  is **not** an authorization boundary.
- **`lib/dal.ts`** — `verifySession()` calls Supabase's auth server and is the
  check that actually counts. Memoized with React `cache()`, so a layout, a page
  and three components asking for the user cost one round trip, not five.

> Next.js 16 renamed the `middleware` file convention to `proxy`, and the
> exported function must be named `proxy`. It runs on the Node.js runtime.

Server Functions are POSTs to the route they live on, so a proxy matcher can
silently stop covering one after a refactor. Each Server Function re-checks
what it needs — see `app/auth/actions.ts`.

Routes:

- `app/auth/callback/route.ts` — OAuth / PKCE code exchange
- `app/auth/confirm/route.ts` — email links (signup, magic link, recovery)
- `app/auth/actions.ts` — sign in, sign up, sign out, password reset, Google

### Google OAuth

The code is wired. **Two things have to be configured by hand** before the
button works — until then, clicking it lands on a Supabase JSON error reading
`provider is not enabled`.

**1 · Google Cloud Console** — [console.cloud.google.com](https://console.cloud.google.com)

Create (or pick) a project, then **APIs & Services → OAuth consent screen**:
choose *External*, set the app name and support email, and add the `email`,
`profile` and `openid` scopes. Then **Credentials → Create credentials → OAuth
client ID → Web application**, and add this as an authorized redirect URI:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

That URI is **Supabase's** callback, not ours. A common wasted hour is putting
`http://localhost:3000/auth/callback` here — Google never redirects to our app
directly; it redirects to Supabase, which then redirects to us.

**2 · Supabase dashboard**

- **Authentication → Providers → Google**: enable it, paste the client ID and
  client secret from step 1.
- **Authentication → URL Configuration**: set *Site URL*, and add every app
  callback to *Redirect URLs* — `http://localhost:3000/auth/callback` for local
  work plus the deployed equivalent. `redirectTo` is rejected if it is not on
  this list.

Verify the provider is live without clicking anything:

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/settings" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" | grep -o '"google":[a-z]*'
```

**Why the flow starts in a Server Function.** `signInWithGoogle` runs on the
server rather than calling the browser client. `signInWithOAuth` mints a PKCE
code verifier and must store it before the user leaves for Google; doing that
server-side writes it to a cookie the server owns, which is what lets
`/auth/callback` complete `exchangeCodeForSession()` on the way back. Start the
flow client-side and the verifier lands somewhere the route handler cannot read,
producing a "code verifier" error that is miserable to debug.

**Profile rows.** `handle_new_user` reads the display name and avatar from
`raw_user_meta_data`, and Google spells those keys differently from our email
signup (`name`/`picture` rather than `full_name`/`avatar_url`). Migration
`0002` coalesces across both, so a Google signup gets a real name in the
sidebar instead of a null.

## Stripe

**There are two Stripe integrations and they are not the same thing.** One is
us charging the contractor for their subscription, on our account. The other is
the contractor charging a homeowner, on his. They share an SDK and a secret key
and nothing else — separate endpoints, separate webhook signing secrets,
separate tables.

### Subscriptions — us charging the contractor

Endpoints:

| Route                       | Purpose                                     |
| --------------------------- | ------------------------------------------- |
| `POST /api/stripe/checkout` | Creates a Checkout Session, returns its URL |
| `POST /api/stripe/portal`   | Opens the Billing Portal                    |
| `POST /api/stripe/webhook`  | Receives and projects Stripe events         |

Local testing:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`. There is an
`npm run stripe:listen` shortcut for the same command.

Create a product and a recurring price in the Stripe Dashboard; the webhook
syncs them into `products` and `prices`, and `/dashboard/billing` renders
whatever is active.

Three things the webhook handler is built around:

1. **Raw body.** Signature verification hashes the exact bytes Stripe sent, so
   the handler uses `request.text()`. `request.json()` would re-serialize and
   every signature check would fail.
2. **Idempotency.** Stripe retries on any non-2xx and can deliver duplicates or
   out of order. Each event id is claimed in `stripe_events` before any work; a
   second delivery is acknowledged without repeating it, and the claim is
   released if the handler throws so a retry gets a real second attempt.
3. **No session.** The route is authenticated by signature and is excluded from
   the proxy matcher so it is never redirected to `/login`.

> **API version.** The SDK is pinned to `2026-07-29.dahlia` in
> `lib/stripe/server.ts`. On this version `current_period_start` / `_end` live
> on the subscription **item**, not the subscription — reading them off the
> subscription silently yields null. Change the pin only alongside an SDK
> upgrade.

Billing tables have read policies but no write policies for normal users. Only
the webhook, which writes over the privileged Postgres connection, changes
what someone is paying.

### Connect — the contractor charging a homeowner

| Route                                | Purpose                                        |
| ------------------------------------ | ---------------------------------------------- |
| `POST /api/stripe/connect/onboard`   | Creates the account, returns a hosted-form link |
| `GET /api/stripe/connect/onboard`    | Stripe's `refresh_url` — mints a fresh link     |
| `POST /api/stripe/connect/dashboard` | A login link into his Express dashboard         |
| `POST /api/stripe/connect/webhook`   | Connect events → `ledger_entries`               |
| `POST /api/share/[token]/pay`        | The homeowner's PaymentIntent, from a share link |

`GET /api/connections/stripe_connect/start` is the button the Office links to;
it creates the account and redirects into Stripe's form, which is why the
connector's `handshake` is `hosted` rather than `oauth2`.

**Accounts are created by us, not linked.** A one-truck shop with no merchant
account is exactly the customer this is for, and telling him to go get one
first is the barrier the connector layer exists to avoid. Two settings are
fixed at creation and one of them is permanent:

| Setting | Value | Why |
| --- | --- | --- |
| `controller.stripe_dashboard.type` | `express` | **Immutable.** Stripe's default `full` is incompatible with platform-held losses, which would foreclose Issuing and Treasury for the life of every account. |
| `controller.losses.payments` | `stripe` | Stripe carries unrecoverable negative balances and its risk team manages the account. Express keeps the other choice available later. |

**Charges are direct charges** on the connected account. The contractor is the
merchant of record: his business name on her statement, and a dispute debits
his balance rather than ours. Our revenue rides along as an
`application_fee_amount` that Stripe splits as the money moves. Customer funds
never touch an account we control — holding them pending our judgment would be
money transmission, a state-licensed activity.

Local testing needs the **Connect** flag, and a second signing secret:

```bash
stripe listen --forward-connect-to localhost:3000/api/stripe/connect/webhook
```

> Pointing both webhooks at one URL does not work. Stripe signs account events
> and Connect events with different secrets, so `STRIPE_WEBHOOK_SECRET` and
> `STRIPE_CONNECT_WEBHOOK_SECRET` are two values and crossing them produces a
> signature failure that reads like a code bug.

## The money ledger

`ledger_entries` is the truth of what **moved**. The documents — contract,
change orders, invoices — remain the truth of what is **owed**. Both exist
because neither subsumes the other: money routinely moves with no document
behind it (a chargeback seven months later, Stripe's fee, a bank payout), and
an obligation is not a movement (a signed contract creates $10,000 of owed
money and moves nothing).

It is **cash-only**. A quote, a signed contract, an approved change order and
an issued invoice all write nothing here.

`lib/ledger` is the whole interface:

- `recordEntry()` — the one door in. Every webhook, matcher and form goes
  through it, and it is idempotent on `(organization, source, external_ref)`.
- `reverseEntry()` — how a wrong row is fixed. **Nothing is ever updated or
  deleted**; a correction is an opposite-signed row pointing at the original,
  so the mistake and the fix both survive.
- `fold.ts` — collected to date, per job, per invoice, per customer,
  shop-wide. Every one is a `sum` over an ordered array.

Four rules are enforced by the database rather than by convention, because
`recordEntry` being the only caller is a claim and this is somebody's money:
`UPDATE`/`DELETE` raise, each entry type must carry its documented sign, a
reversal must negate its target exactly, and a payout may never name a job.
`npm run ledger:check` proves all four against a real database inside a
transaction it rolls back.

> **There is no `payments` table.** There was, and it was the source of
> "collected" on six surfaces; it is gone because it was the same fact as
> `payment_received` kept in a second place. A cheque is now a
> `payment_received` with `source = 'manual'` — first-class and exactly equal
> to a card, which is the point.

## Documents

`documents` is the truth of what is **owed** — the other half of the ledger.
One spine table plus a per-type side table, so that everything which points
*at* a document (share links, scope nodes, evidence, questions) can carry a
real foreign key instead of an unenforceable `type` + `id` pair.

| Table | Holds |
| --- | --- |
| `documents` | The spine: type, number, status, header snapshot, freeze |
| `quote_details` … `invoice_details` | The four to six fields each type adds |
| `scope_nodes` | The Scope tree, per document, copied when one generates another |
| `document_options` / `option_nodes` | Tiers naming a subset of the tree |
| `document_signatures` | Append-only audit records — party, name, mark, time, IP |

**The header is snapshotted, never joined.** A quote sent in March still shows
the March address after the shop moves in June.

**A document freezes itself.** Nothing calls "freeze": moving `status` into the
type's frozen set stamps `frozen_at` from a trigger, so no code path can
forget. `lib/documents/lifecycle.ts` is the single source for
`{type, status} → mutable`, and the SQL is generated from it:

```bash
npm run documents:freeze-sql
```

The freeze protects what was *agreed*, not what happened next — `status`,
`sent_at`, `viewed_at`, an invoice's `voided_at` and `gate_met_at`, and an
allowance's settlement all keep moving afterwards. That last one is load-bearing:
an allowance lives on a signed contract, and settlement writes onto the
allowance node itself.

```bash
npm run documents:check
```

```bash
npm run signing:check
```

39 checks, all against the role product code actually connects as, inside a
transaction that rolls back.

> **The old tables are still here.** `quotes`, `contracts`, `change_orders`,
> `invoices` and `line_items` still back every read surface. They go in the pass
> that ports those surfaces onto the spine, which is also when
> `ledger_entries.invoice_id`, `draw_schedule`, `evidence` and `share_links`
> repoint at `documents.id`. Until then, nothing writes to the spine in
> production paths.

## Signing

DocuSign-shaped, without DocuSign — no envelope round-trip, no webhook, no
per-signature fee, and the signed artifact lives in our own database.

What a vendor actually sells is not the drawing tool. It's the four things that
make a mark into evidence, and `lib/signing/` is one module per thing:

| Module | Does |
| --- | --- |
| `mark` | What a signature *is* — an adopted name, or SVG path data |
| `disclosure` | The ESIGN §101(c) electronic-records consent |
| `hash` | SHA-256 of what was on the page |
| `sign` | The write, with every audit field captured server-side |
| `certificate` | The Certificate of Completion |

**Drawn marks are SVG paths, not PNGs.** A 400×150 PNG is 15–40 KB of base64
per signature and prints soft; the same stroke as path data is under 2 KB and
scales to any exhibit size. The stored value is rendered into an SVG `d`
attribute, so `drawnMark()` sanitizes it — that's a security control, not
validation.

**Consent is its own recorded fact.** A signature is only enforceable against a
consumer if they consented to electronic records first, after a disclosure
covering paper, withdrawal and system requirements. "They signed, therefore they
consented" is the reasoning an issuer discounts, so `consented_at` is a separate
column and the checkbox is never pre-ticked.

**The hash is what associates the signature with the record.** A foreign key
says *these rows are related*; a hash says *the thing I signed said exactly
this*. It covers what the signer could see — header, terms, priced scope,
amounts — and deliberately excludes cost and markup, so an internal margin
correction can't invalidate her signature.

**Nothing is trusted from the client.** Time, IP, user agent and hash are all
taken from the request server-side. The body carries a name, a mark and a
consent flag; that's all.

```bash
npm run signing:check
```

> The disclosure text in `lib/signing/disclosure.ts` is a good-faith
> implementation of the statutory checklist. **It has not been reviewed by a
> lawyer.** Get that done before the first real contract is signed on it.

## The API

**Route handlers are the default. Server Actions are the exception.**

The reason is not preference. A Server Action is not an addressable endpoint —
it POSTs to whatever route rendered it, identified by a build-specific id in a
`Next-Action` header that changes on every deploy. There is no stable contract,
so **the native app in scope (surface class A) cannot call one**, and neither
can Postman, curl, or any future integration.

What Server Actions genuinely buy, and why a few are kept:

| | Server Action | Route handler |
|---|---|---|
| Callable by a native app | ✗ | ✓ |
| Progressive enhancement (works pre-JS) | ✓ | ✗ |
| Automatic CSRF (Origin/Host check) | ✓ | you do it |
| Mutation + UI update in one round trip | ✓ | two |
| Stable, versionable URL | ✗ | ✓ |

**Kept as Server Actions** — everything in `app/auth/actions.ts`: sign in, sign
up, sign out, password reset, and Google OAuth. They set cookies and redirect,
they benefit from the built-in CSRF check, and a native client would use the
Supabase SDK for auth directly rather than proxying through us. `signInWithGoogle`
additionally *must* be one, so the PKCE verifier lands in a server-owned cookie.

**Everything else is a route handler.**

### Shape

Base path `/api/v1`. Every response is `{ data }` or
`{ error: { code, message, details? } }` — a client branches on `code`, never on
the prose in `message`.

| Route | Methods |
|---|---|
| `/api/v1/organizations` | `GET` `POST` |
| `/api/v1/customers` | `GET` `POST` |
| `/api/v1/jobs` | `GET` `POST` |
| `/api/v1/jobs/[id]` | `GET` `PATCH` |

`/api/stripe/checkout` and `/api/stripe/portal` follow the same conventions.
`/api/stripe/webhook` stays unversioned and outside the envelope — its URL is
registered with Stripe and its body shape is Stripe's, not ours.

### Authenticating

Two credentials, one code path (`lib/api/auth.ts`):

- **Bearer** — `Authorization: Bearer <supabase access token>`. What the native
  app and Postman use. The token is verified against the Auth server, not just
  decoded.
- **Cookie** — the browser session, for calls from the web app.

Organization scoping resolves in this order: an `X-Organization-Id` header, then
the caller's only membership, then a refusal. It is never guessed — and it is
always checked against a membership row, because **Drizzle connects as a role
that bypasses RLS**, so an id from a client is an assertion until proven.

> **The proxy does not touch `/api`.** Redirecting an unauthenticated API call
> to `/login` hands a client a 307 to an HTML page with a 200 on it, which is
> indistinguishable from success. Route handlers answer 401 with a JSON body
> instead. Session cookies are still refreshed for `/api`.

### Smoke test

```bash
npm run api:smoke
```

Drives the API the way a native client would — real bearer tokens, no cookies —
covering auth, validation, tenant isolation, the numbering triggers and the
derived money state. Needs the dev server up. It creates two throwaway users
(`api-test@fsm.local`, `api-test-2@fsm.local`) and is safe to re-run.

## UI — shadcn/ui

Components are **only** added through the official CLI. Do not hand-write a
file into `components/ui/`:

```bash
npx shadcn@latest add <component>
```

Useful companions:

```bash
npx shadcn@latest search @shadcn -q <term>
```

```bash
npx shadcn@latest docs <component>
```

The project is on base `radix` with the `nova` preset (`components.json`), so
CLI output matches https://ui.shadcn.com/docs/components/radix/*.

**Known gap:** `@shadcn/form` resolves to an empty registry stub on this
base/preset — no files, no docs link — so the react-hook-form `<Form>` wrapper
is not installable. The auth forms therefore use Server Functions with
`useActionState` (`components/auth/login-form.tsx`), which is the idiomatic
Next 16 approach and needs no client form library. If you want react-hook-form
later, pull the component from the shadcn docs by hand rather than letting it
be invented.

## Sentry

- `sentry.server.config.ts` — server SDK, loaded from `instrumentation.ts`
- `instrumentation-client.ts` — browser SDK plus navigation tracing
- `instrumentation.ts` — `onRequestError` reports server render/route errors
- `app/global-error.tsx` — catches root layout errors
- `next.config.ts` — `withSentryConfig` handles source map upload

Sentry stays disabled until `NEXT_PUBLIC_SENTRY_DSN` is set, so local dev is
unaffected. `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are only
needed at build time to upload source maps.

Events are tunnelled through `/monitoring` so ad-blockers do not eat error
reports. That path is excluded from the proxy matcher — if you change
`tunnelRoute`, update the matcher in `proxy.ts` to match.

`sendDefaultPii` is off: this app handles customer names, addresses and phone
numbers, and sending them to a third party should be a deliberate decision.

## Project layout

Three route groups, matching the three surface classes in the IA.

```
app/
  (public)/              Class B·W — landing, pricing, /for/[trade], legal
  (auth)/                login · signup
  (app)/                 Class B — the contractor's desk shell (sidebar + header)
    dashboard/           Screen 25 — gates and next actions
    quotes/              List, editor (screen 4), info request
    jobs/[id]/           Job hub (17) + capture · complete · money · receipt
                         · change-orders · contract · invoices · permits
    customers/  invoices/  price-book/  contracts/new/
    upgrade/             Plan picker + checkout
    office/              The business — identity, branding, defaults, licenses,
                         automations, packs, connections, data
    settings/            The app — appearance, notifications
    account/             The person — sign-in, billing
  share/[token]/         Class C — the homeowner. No shell, no nav, no account
  api/stripe/            checkout, portal, webhook
  api/v1/                The typed API — office, quotes, jobs, invoices, …
  auth/                  Server Functions + callback/confirm routes
components/
  ui/                    shadcn/ui — CLI-generated, do not hand-edit
  app-sidebar · app-header · new-menu · section-nav       The shell
  quote-editor · invoice-editor · page-header             Shared surfaces
  office/  settings/  account/  auth/  billing/           Feature components
drizzle/                 Migration history (generated + hand-written SQL)
lib/
  db/schema/             Drizzle schema — source of truth for the database
    office.ts            The Office — its own attributes, plus customers,
                         licenses, presets, assemblies, packs, defaults
  nav.ts                 Navigation config — mirrors IA §3.1, §3.2 and §5.3
  supabase/              client / server / proxy / storage
  stripe/                SDK instance, sync layer
  dal.ts                 Authorization boundary
  env.ts                 Validated environment access
proxy.ts                 Session refresh + optimistic auth redirect
```

### The occasional-use wing is three destinations, not one

IA §5.3 splits it by **whose thing it is**, and that split is the only thing
keeping any of the three from becoming a junk drawer:

| Destination | Whose it is | Holds |
|---|---|---|
| `/office` | The business | Identity, document branding, defaults, licenses, automations, trade packs, connections, data |
| `/settings` | The app | Appearance, notifications |
| `/account` | The person | Sign-in, billing |

Three consequences that are easy to get wrong:

- **Only the Office has a section rail.** Settings and Account are one screen
  each, which is the finding wireframe 94 · 56b was drawn to prove: everything
  that made Settings feel like a wing turned out to belong to the business, and
  what remained is six controls and a bill. A rail with two rows in it would
  dress those up as wings they are not.
- **Appearance means two different things, so it is two words.** *Document
  branding* (`/office/branding`) is how the business looks to a homeowner.
  *Appearance* (a section of `/settings`) is how the app looks to the
  contractor. Same split again for *automations* (the business speaking) versus
  *notifications* (what reaches you) — and each screen names the other.
- **The route segment matches the label** (IA §2). Where they diverge, one of
  them is wrong — which is why the nav, the breadcrumbs and the routes are all
  generated from `lib/nav.ts`.

Old `/settings/*` addresses redirect permanently from `next.config.ts`. The
account menu holds exactly three rows — Settings, Account, Sign out — and a
fourth would mean something got misfiled.

### Shop is a reserved word

Content Design §5.1 holds *Shop* for the physical-location object that arrives
at team tier — a stock of material, a crew, a service area. The business itself
is **the Office**, and that is the model term in the schema, the queries, the
routes and the interface. Lowercase *shop* still means what it means in the
trade in ordinary prose and in comments; it is never a synonym for the account.

### Navigation follows the IA, not the wireframes

The drawn set uses an invented alternative — *Home · Jobs · Money · Customers ·
Price book · Settings* — which fails a rule rather than a preference: a
navigation destination must be an object you can list instances of, and *Money*
has no instances. The settled set is *Dashboard · Quotes · Jobs · Customers ·
Invoices · Price Book · Office*.

**The Office is the one non-object in that list, and it is deliberate.** It has
one instance and no lifecycle, so by the rule it should sit behind the account
menu with Settings and Account. It earns a sidebar slot anyway because a
contractor *returns to it in order to work* — the license for a township, the
pack their trade runs on, the deposit every quote starts from. Settings and
Account are visited rarely and on purpose, which is what the account menu is
for.

The wireframe set still draws a single Settings wing with the groups *My
business · How it runs · Account*. That is the previous iteration; the Sep 2
IA supersedes it.

## Checks

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run build
```

Three that need a database, and write only throwaway rows:

```bash
npm run ledger:check
```

```bash
npm run documents:check
```

```bash
npm run signing:check
```

```bash
npm run connector:check
```

```bash
npm run quote:persist-check
```

## Notes on this Next.js version

This is Next.js 16 and it differs from older App Router material in ways that
matter here:

- `middleware.ts` is deprecated — the convention is `proxy.ts` exporting `proxy`
- `cookies()`, `headers()`, `params` and `searchParams` are async
- The Edge runtime is deprecated; Node.js is the default everywhere
- Turbopack is the default for both `next dev` and `next build`
- `LayoutProps<...>` / `PageProps<...>` are generated globals — run
  `npx next typegen` after adding routes if the editor has not caught up

`AGENTS.md` points at the version-matched docs bundled in
`node_modules/next/dist/docs/`. Read those rather than relying on memory.
