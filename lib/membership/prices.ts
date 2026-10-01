import "server-only";

import { cache } from "react";
import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { prices } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe/server";

import { PRICES, catalogPrice, type CatalogPrice } from "./catalog";

/**
 * Lookup key ↔ Stripe price, read from the mirror.
 *
 * **Amounts shown to people come from here**, never from the catalog's own
 * numbers: what a page quotes is what Stripe will charge. A key missing from
 * the mirror is a price that is not for sale in this environment, and the
 * surfaces say so rather than inventing a figure.
 */

export type LivePrice = {
  id: string;
  lookupKey: string;
  unitAmount: number;
  spec: CatalogPrice;
};

export const getPriceBook = cache(async (): Promise<Map<string, LivePrice>> => {
  const rows = await db
    .select({ id: prices.id, lookupKey: prices.lookupKey, unitAmount: prices.unitAmount })
    .from(prices)
    .where(and(eq(prices.active, true), isNotNull(prices.lookupKey)));

  const book = new Map<string, LivePrice>();
  for (const row of rows) {
    const spec = catalogPrice(row.lookupKey);
    if (!spec || row.unitAmount === null || !row.lookupKey) continue;
    book.set(row.lookupKey, {
      id: row.id,
      lookupKey: row.lookupKey,
      unitAmount: row.unitAmount,
      spec,
    });
  }
  return book;
});

/** The Stripe price id for a lookup key, or a clear refusal. */
export async function priceIdFor(lookupKey: string): Promise<string> {
  const book = await getPriceBook();
  const hit = book.get(lookupKey);
  if (hit) return hit.id;

  // The mirror can lag a fresh seed. Ask Stripe once before refusing.
  const listed = await stripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = listed.data[0];
  if (!price) {
    throw new Error(`No active Stripe price holds the lookup key "${lookupKey}". Run npm run stripe:seed.`);
  }
  return price.id;
}

/** Cents for a lookup key, or null when it is not on sale here. */
export async function amountFor(lookupKey: string): Promise<number | null> {
  return (await getPriceBook()).get(lookupKey)?.unitAmount ?? null;
}

/** The catalog entry behind a Stripe price, by its lookup key. */
export function specForStripePrice(price: { lookup_key?: string | null }) {
  return catalogPrice(price.lookup_key ?? null);
}

export { PRICES };
