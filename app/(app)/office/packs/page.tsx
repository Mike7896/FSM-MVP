import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { ComingSoon } from "@/components/coming-soon";
import { PackSwitch } from "@/components/office/pack-switch";
import { Badge } from "@/components/ui/badge";
import { requireActiveOrganization } from "@/lib/dal";
import { formatMoney } from "@/lib/quote";
import { getSubscription } from "@/lib/queries/billing";
import { listPacks } from "@/lib/queries/office";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Trade packs" };

/**
 * Screen 36 · the trade-pack catalog · Flow 13, job TP2.
 *
 * TP2's entire anxiety is **"is this real, or an upsell?"** and specificity is
 * the only thing that answers it: **sell counted contents, never adjectives.**
 * "24 job types, wire by gauge and footage, permit handling" is a product;
 * "supercharge your electrical workflow" is not.
 *
 * **Entitlement and enablement are separate axes**, so owned-but-off is a
 * visible state that explains itself rather than a mystery that invites a
 * second purchase.
 *
 * Prices come from the Stripe read-model rather than from the catalogue. A pack
 * with no active price is shown without one — the money has to come from the
 * system that will actually charge for it, and a number invented here would be
 * a number the checkout then disagrees with.
 */
export default async function PacksPage() {
  const org = await requireActiveOrganization();

  const [packs, subscription] = await Promise.all([
    listPacks(org.id),
    getSubscription(org.id),
  ]);

  const planCents = subscription?.price?.unitAmount ?? null;
  const packCents = packs
    .filter((state) => state.entitled && state.priceCents !== null)
    .reduce((sum, state) => sum + (state.priceCents ?? 0), 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Trade packs"
        description={billLine(planCents, packCents, subscription?.product?.name)}
      />

      <div className="flex flex-col gap-3">
        {packs.map(({ pack, entitled, enabled, priceCents }) => {
          const coming = pack.status === "coming";

          return (
            <div
              key={pack.id}
              className={cn(
                "rounded-xl border p-4",
                enabled && "border-primary/60 bg-primary/[0.03]",
                coming && "opacity-70"
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold">{pack.name}</h2>
                <div className="flex flex-wrap items-center gap-3">
                  {priceCents !== null ? (
                    <span className="text-muted-foreground text-sm tabular-nums">
                      {formatMoney(priceCents)}/mo
                    </span>
                  ) : null}
                  {entitled ? (
                    <PackSwitch
                      packId={pack.id}
                      packName={pack.name}
                      enabled={enabled}
                    />
                  ) : coming ? (
                    <ComingSoon />
                  ) : (
                    <Badge variant="outline">Available</Badge>
                  )}
                </div>
              </div>

              <p className="text-muted-foreground mt-1.5 text-sm">
                {pack.summary}
              </p>

              {entitled && !enabled ? (
                // Owned-but-off, stated. Otherwise a contractor who switched a
                // trade off six months ago meets this row and buys it again.
                <p className="text-muted-foreground mt-2 text-xs">
                  You own this. It&apos;s switched off, so new quotes don&apos;t
                  use its templates — quotes already written with it are
                  untouched.
                </p>
              ) : null}

              {!coming ? (
                <Link
                  href={`/office/packs/${pack.id}`}
                  className="text-primary-ink mt-2 inline-block text-sm underline underline-offset-4"
                >
                  {entitled ? "See what's inside" : "See what's inside"}
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* The line that costs a sale, and is what makes the rest credible. */}
      <p className="text-muted-foreground rounded-xl border p-4 text-sm">
        <strong className="text-foreground font-medium">
          You don&apos;t need a pack to run the business.
        </strong>{" "}
        Quotes, deposits, draws, invoices and collections all work without one. A
        pack adds your trade&apos;s vocabulary and templates.
      </p>
    </div>
  );
}

/**
 * What the business is paying, said as arithmetic they can check.
 *
 * With no subscription behind it there is no bill to describe, and saying so is
 * better than rendering "$0/mo" — which reads as a claim about their plan
 * rather than an absence of one.
 */
function billLine(
  planCents: number | null,
  packCents: number,
  planName?: string | null
): string {
  if (planCents === null) {
    return "What your trade adds to the quote editor you already use.";
  }

  const total = planCents + packCents;
  const parts = [`${planName ?? "Plan"} ${formatMoney(planCents)}`];
  if (packCents > 0) parts.push(`packs ${formatMoney(packCents)}`);

  return `You pay ${formatMoney(total)}/mo — ${parts.join(" + ")}.`;
}
