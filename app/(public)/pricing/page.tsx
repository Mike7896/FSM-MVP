import type { Metadata } from "next";

import { PlanGrid } from "@/components/billing/plan-grid";
import { PACKS } from "@/lib/packs/catalog";
import { formatMoney } from "@/lib/quote";
import { getActivePlans } from "@/lib/queries/billing";
import { prices } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";

export const metadata: Metadata = { title: "Pricing" };

/**
 * Screen 48 · the pricing page · class B·W, Flow 17.
 *
 * Serves someone **comparison-shopping before signup**: the full picture, all
 * tiers, objections handled. The in-app `/upgrade` picker is the other half —
 * someone mid-decision who wants permission to stop deciding. Same prices,
 * different jobs, and the same `PlanGrid` reading the same Stripe rows, so the
 * marketing page cannot promise a number the checkout then refuses.
 *
 * Two rules the page is built on:
 * - **Core + pack = one total.** A contractor pays one bill, and the page shows
 *   the arithmetic rather than two prices to add up themselves.
 * - **Free is capped, never crippled.** Watermark-everything and can't-send
 *   kills the product-led loop, because the free-tier share link *is* the
 *   marketing.
 *
 * Unauthenticated, so there is no organization and no checkout — the grid falls
 * back to a signup link.
 */
export default async function PricingPage() {
  const [plans, packPrices] = await Promise.all([
    getActivePlans(),
    db
      .select({ id: prices.id, unitAmount: prices.unitAmount })
      .from(prices)
      .where(eq(prices.active, true)),
  ]);

  const priceFor = new Map(packPrices.map((row) => [row.id, row.unitAmount]));

  const packRows = PACKS.map((pack) => ({
    pack,
    priceCents: pack.stripePriceLookupKey
      ? (priceFor.get(pack.stripePriceLookupKey) ?? null)
      : null,
  }));

  const cheapestPaid = plans.find((row) => (row.price.unitAmount ?? 0) > 0);
  const leadPack = packRows.find(
    (row) => row.pack.status === "available" && row.priceCents !== null
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          One bill, however many trades.
        </h1>
        <p className="text-muted-foreground mt-4 text-lg">
          A core plan plus a monthly amount for each trade pack you turn on.
          Against an $80–195 hourly rate, this is under thirty minutes of your
          time.
        </p>
      </div>

      <div className="mt-12">
        <PlanGrid plans={plans} signUpHref="/signup" />
      </div>

      <section className="mt-16 border-t pt-12">
        <h2 className="text-2xl font-semibold tracking-tight">Trade packs</h2>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          A pack makes the whole workflow speak your trade — its job types,
          templates, taxonomy and scope language. It&apos;s a line added to the
          same monthly bill, not a second subscription.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packRows.map(({ pack, priceCents }) => (
            <div key={pack.id} className="rounded-xl border p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-medium">{pack.name}</h3>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {/* One phrase for "not yet", matching the app's label. */}
                  {pack.status === "coming" || priceCents === null
                    ? "Coming soon"
                    : `+${formatMoney(priceCents)}/mo`}
                </span>
              </div>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {pack.summary}
              </p>
              <ul className="text-muted-foreground mt-3 flex flex-col gap-1 text-xs">
                {/* Counted contents, never adjectives — the only thing that
                    answers "is this real, or an upsell?" */}
                {pack.contents.slice(0, 3).map((row) => (
                  <li key={row.title}>
                    {row.count !== null ? (
                      <strong className="text-foreground font-medium tabular-nums">
                        {row.count}{" "}
                      </strong>
                    ) : null}
                    {row.title}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {cheapestPaid && leadPack ? (
          <div className="mt-8 rounded-xl border p-5">
            <p className="text-muted-foreground font-label text-[11px] uppercase">
              What that adds up to
            </p>
            <p className="mt-3 text-sm">
              {cheapestPaid.product.name} at{" "}
              {formatMoney(cheapestPaid.price.unitAmount ?? 0)} with the{" "}
              {leadPack.pack.name.toLowerCase()} pack on bills at{" "}
              <strong className="font-semibold tabular-nums">
                {formatMoney(
                  (cheapestPaid.price.unitAmount ?? 0) + (leadPack.priceCents ?? 0)
                )}
                /mo
              </strong>
              . One bill, one card, one membership.
            </p>
          </div>
        ) : null}
      </section>

      <section className="mt-16 border-t pt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          The things people ask
        </h2>
        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          {[
            {
              q: "Is the free plan a demo?",
              a: "No. It's the same product with a cap on how many quotes you send a month. Everything sends for real, and your customer's experience is identical.",
            },
            {
              q: "Do I need a trade pack?",
              a: "No. Quotes, deposits, draws, invoices and collections all work without one. A pack adds your trade's vocabulary and templates.",
            },
            {
              q: "What happens to my data if I leave?",
              a: "It exports in standard formats, and it's available always — not just at cancellation. Jobs in flight keep running and their links stay live.",
            },
            {
              q: "Does my customer need an account?",
              a: "Never. Everything you send opens from a link on their phone — review, approve, sign and pay, with nothing to install.",
            },
          ].map((item) => (
            <div key={item.q}>
              <h3 className="font-medium">{item.q}</h3>
              <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
