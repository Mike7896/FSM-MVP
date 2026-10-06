# Marketing audit and implementation — October 6, 2026

## Direction

Preserve the existing amber, ink, paper, Inter, and Archivo identity. The visitor is an independent contractor deciding whether to try a first real job. The central story is the connected quote-to-payment workflow. Illustrative examples are labeled; no invented testimonials, adoption counts, savings percentages, or production-payment proof were added.

Used the installed Impeccable and founder-skills CRO guidance. The earlier marketing design document recorded recommendations, not completed skill installations. Impeccable's context launcher could not initialize its external cache; incumbent source and screenshots supplied the visual context.

## Findings addressed

| Priority | Finding | Implemented response |
| --- | --- | --- |
| High | Homepage claimed QuickBooks syncing although `lib/connectors/quickbooks/push.ts` still throws “not built yet.” | Removed syncing and connected-books promises; describe job payment records instead. |
| High | Saved pricing and branding benefits could read as Free-plan features. | Explain Starter/Pro saved items and Pro logos; retain business details on all plans. |
| High | Visitors had little concrete explanation of contracts, changes, and phased billing. | Added a keyboard-accessible four-stage sample job with consistent amounts: $8,400 quote, $4,200 deposit, $600 change, $9,000 revised value, $2,520 progress payment, $2,280 remaining. |
| Medium | Mobile header hid all product/pricing navigation. | Added visible mobile product-tour, pricing, and electrician links; extended footer navigation. |
| Medium | Trade pages were sparse and repeated generic copy. | Added trade-specific scope examples and fuller workflow explanations for electricians, plumbers, roofers, and remodelers. Roofers/remodelers previously used the generic fallback. Signup retains the existing trade query. |
| Medium | Browser availability, homeowner account requirements, payments, and plan distinctions were unclear before signup. | Added homepage FAQs and customer/schedule/task explanations. |
| Medium | Arbitrary trade URLs generated generic landing pages. | Unknown slugs now return 404; own-property checks prevent inherited object keys from masquerading as trade configuration. |
| Low | Pricing and trade metadata lacked useful descriptions. | Added descriptive metadata and a pricing-to-product-tour link. |

## Conversion review

All thirteen CRO principles were considered: clarity, a single core outcome, message match, objections, hierarchy, cognitive load, trust, responsible behavioral cues, section usefulness, CTA discipline, scannability, momentum, and evidence. The existing hero identity remains; its description now names the product category and audience. The tour gives curious visitors a low-commitment path, followed by concrete feature and plan explanations. Signup remains the primary action. No new signup fields, pricing system, urgency tactics, or analytics trackers were introduced.

The hypothesis is better product understanding before signup, not a claimed conversion lift. At current traffic, ask pilot contractors to explain the workflow and plan differences after viewing the page. Actual testimonials and screenshots from consented pilot usage can replace or supplement illustrative examples later.

## Validation

- TypeScript check: passed after final changes.
- ESLint for all changed TSX files and the acceptance script: passed.
- `git diff --check`: passed (Git reports only line-ending normalization warnings).
- Local homepage acceptance: **22 assertions passed**, including all four stage panels, arrow-key navigation, FAQ interaction, mobile section links, 390px and 320px layouts, one H1, unknown-trade 404, and no uncaught browser errors.
- Desktop, mobile, and dark-mode screenshots inspected. An initial offscreen screenshot after theme switching had incomplete rasterization; a fresh dark-mode load and DOM computed-style inspection confirmed the document's ink colors and content.
- Production build compiled and completed its TypeScript stage, then failed while prerendering pricing because the configured development Supabase branch no longer exists. The user confirmed its accidental deletion and is restoring it.
- Pricing and known-trade browser checks remain **pending**, not passed. Earlier partial run output in `marketing-evidence/results.json` is incomplete; `homepage-results.json` records the successful database-independent run.

## Local preview configuration and boundary

`.env.local` also has an empty `STRIPE_CONNECT_WEBHOOK_SECRET`, which fails server environment validation. The local preview used a process-only dummy value to render UI; it cannot verify real webhooks. No environment files changed. No signup, subscription, payment, or production settings were modified.

Automatic approval review rejected a proposed production-backed local preview. That approach was abandoned. All completed browser checks use the database-independent local homepage; no production database was attached to the preview.

## Resume after development database restoration

1. Update `.env.local` with the replacement development branch and an appropriate development Connect webhook secret (or remove the empty optional entry when not testing webhooks).
2. Restart the local server to discard the old connection pool.
3. Run `node scripts/marketing-acceptance.mjs` for all marketing routes. `--homepage-only` remains available for database-independent checks.
4. Run `npm run build` and inspect the trade screenshots. Do not treat compilation alone as a completed production build.

Changes are local and uncommitted; no deployment was performed.
