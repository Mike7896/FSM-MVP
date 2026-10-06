/**
 * Writes `stripe/fixtures/membership.json` from `lib/membership/catalog.ts`.
 *
 * The catalog is the Launch Billing Specification in code; this turns it into
 * a Stripe CLI fixtures file so a sandbox can be seeded with exactly the
 * products, prices and customer-portal configuration the spec names:
 *
 *     npm run stripe:fixtures          # regenerate the JSON
 *     npm run stripe:seed              # apply it to the sandbox, then mirror it
 *
 * **Run the seed once per Stripe account.** Product ids are fixed
 * (`sc_core_starter`…) so every environment has the same four products, and
 * Stripe refuses to create an id twice. Prices carry `transfer_lookup_key`, so
 * a new price version (a `_v2` key, or a changed amount under the same key)
 * takes the lookup key over from the old one rather than failing.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PRICES,
  PRODUCTS,
  SAAS_TAX_CODE,
  type ProductKey,
} from "../lib/membership/catalog";

type Fixture = {
  name: string;
  path: string;
  method: "post";
  params: Record<string, unknown>;
};

export function membershipFixtures(): Fixture[] {
const fixtures: Fixture[] = [];

for (const [key, product] of Object.entries(PRODUCTS) as [
  ProductKey,
  (typeof PRODUCTS)[ProductKey],
][]) {
  fixtures.push({
    name: `product_${key}`,
    path: "/v1/products",
    method: "post",
    params: {
      id: product.id,
      name: product.name,
      description: product.description,
      tax_code: SAAS_TAX_CODE,
      metadata: { app: "serviceclerk", catalog_key: key },
    },
  });
}

for (const price of PRICES) {
  const role =
    price.role.kind === "core"
      ? {
          role: "core",
          tier: price.role.tier,
          founding: String(price.role.founding),
        }
      : price.role.kind === "pack"
        ? { role: "pack", pack: price.role.pack }
        : { role: "ai_topup", credits: String(price.role.credits) };

  fixtures.push({
    name: `price_${price.lookupKey}`,
    path: "/v1/prices",
    method: "post",
    params: {
      product: `\${product_${price.product}:id}`,
      currency: "usd",
      unit_amount: price.amountCents,
      tax_behavior: "exclusive",
      lookup_key: price.lookupKey,
      transfer_lookup_key: true,
      nickname: price.lookupKey,
      ...(price.interval
        ? { recurring: { interval: price.interval, interval_count: 1 } }
        : {}),
      metadata: {
        app: "serviceclerk",
        ...role,
        ...(price.release ? { release: price.release } : {}),
      },
    },
  });
}

/**
 * The customer portal (§11.2): payment details, SaaS invoices and
 * whole-subscription cancellation — and **no plan or pack changes**, which go
 * through the app's validated flow so a pack can never be left without a paid
 * core. The app finds this configuration by its metadata.
 */
fixtures.push({
  name: "portal_configuration",
  path: "/v1/billing_portal/configurations",
  method: "post",
  params: {
    name: "ServiceClerk membership v1",
    metadata: { app: "serviceclerk", portal: "membership_v1" },
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ["email", "address", "name", "tax_id"],
      },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        proration_behavior: "none",
        cancellation_reason: {
          enabled: true,
          options: [
            "too_expensive",
            "missing_features",
            "switched_service",
            "unused",
            "other",
          ],
        },
      },
      subscription_update: { enabled: false },
    },
  },
});

return fixtures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const fixtures = membershipFixtures();
const out = resolve(process.cwd(), "stripe/fixtures/membership.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({ _meta: { template_version: 0 }, fixtures }, null, 2) + "\n"
);

console.log(`Wrote ${fixtures.length} fixtures to ${out}`);
}
