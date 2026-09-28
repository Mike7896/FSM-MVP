/**
 * Mirrors the Stripe account's products and prices into the read-model.
 *
 *     npm run stripe:sync
 *
 * Run after `stripe:seed`, or whenever the webhook was not listening while the
 * catalog changed. Safe to run any number of times — every write is an upsert.
 */

import { syncCatalog } from "@/lib/stripe/sync";

const result = await syncCatalog();
console.log(`Mirrored ${result.products} products and ${result.prices} prices.`);
process.exit(0);
