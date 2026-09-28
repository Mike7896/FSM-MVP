/**
 * Does the Stripe account match the Launch Billing Specification?
 *
 *     npm run stripe:check
 *
 * Every price in `lib/membership/catalog.ts` is looked up by its lookup key
 * and compared field by field — amount, interval, currency, tax behaviour,
 * product. Then the pieces the app depends on but cannot create for itself:
 * the portal configuration and Stripe Tax. A mismatch fails the run.
 *
 * Tax is reported, not failed: an inactive Stripe Tax is a release gate the
 * founder closes (§14.2), and checkout already refuses to pretend a zero
 * result means nothing is owed.
 */

import { PRICES, PRODUCTS } from "@/lib/membership/catalog";
import { stripe } from "@/lib/stripe/server";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nPRODUCTS");
for (const product of Object.values(PRODUCTS)) {
  try {
    const found = await stripe().products.retrieve(product.id);
    check(`${product.id} exists and is active`, found.active);
    check(`${product.id} is named "${product.name}"`, found.name === product.name, found.name);
  } catch {
    check(`${product.id} exists`, false, "not found — run npm run stripe:seed");
  }
}

console.log("\nPRICES");
const keys = PRICES.map((price) => price.lookupKey);
// Stripe takes at most ten lookup keys per request.
const listed = [];
for (let i = 0; i < keys.length; i += 10) {
  const page = await stripe().prices.list({ lookup_keys: keys.slice(i, i + 10), limit: 100 });
  listed.push(...page.data);
}
const byKey = new Map(listed.map((price) => [price.lookup_key, price]));

for (const spec of PRICES) {
  const price = byKey.get(spec.lookupKey);
  if (!price) {
    check(`${spec.lookupKey} exists`, false, "no price holds this lookup key");
    continue;
  }
  const productId = typeof price.product === "string" ? price.product : price.product.id;
  check(
    `${spec.lookupKey} = ${spec.amountCents}¢ ${spec.interval ?? "one-time"}`,
    price.unit_amount === spec.amountCents &&
      (price.recurring?.interval ?? null) === spec.interval &&
      (price.recurring?.interval_count ?? 1) === 1,
    `${price.unit_amount}¢ ${price.recurring?.interval ?? "one-time"}`
  );
  check(`${spec.lookupKey} is USD, tax-exclusive, active`,
    price.currency === "usd" && price.tax_behavior === "exclusive" && price.active,
    `${price.currency} ${price.tax_behavior} active=${price.active}`);
  check(`${spec.lookupKey} belongs to ${PRODUCTS[spec.product].id}`,
    productId === PRODUCTS[spec.product].id, productId);
}

console.log("\nCUSTOMER PORTAL");
const portals = await stripe().billingPortal.configurations.list({ limit: 100, active: true });
const portal = portals.data.find((row) => row.metadata?.portal === "membership_v1");
check("membership portal configuration exists", Boolean(portal));
if (portal) {
  check("portal cannot change plans or packs", !portal.features.subscription_update.enabled);
  check("portal cancels at period end", portal.features.subscription_cancel.enabled &&
    portal.features.subscription_cancel.mode === "at_period_end");
}

console.log("\nSTRIPE TAX (reported, not failed)");
try {
  const settings = await stripe().tax.settings.retrieve();
  console.log(`  ${settings.status === "active" ? "ok  " : "note"} tax settings status: ${settings.status}`);
  const registrations = await stripe().tax.registrations.list({ status: "active", limit: 100 });
  console.log(`  ${registrations.data.length ? "ok  " : "note"} active registrations: ${registrations.data.length}`);
} catch (error) {
  console.log(`  note couldn't read tax settings: ${error instanceof Error ? error.message : error}`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
process.exit(0);
