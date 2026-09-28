import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { CheckoutButton } from "@/components/billing/checkout-button";
import { PageHeader } from "@/components/page-header";
import { PackSwitch } from "@/components/office/pack-switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { requireActiveOrganization } from "@/lib/dal";
import { findPack } from "@/lib/packs/catalog";
import { formatMoney } from "@/lib/quote";
import { getSubscription } from "@/lib/queries/billing";
import { listPacks } from "@/lib/queries/office";

export const metadata: Metadata = { title: "Trade pack" };

/**
 * Screen 37 · pack detail · Flow 13, job TP2.
 *
 * The decision this page serves is about **a monthly total the contractor
 * recognises**, not a list price — so the arithmetic runs against their own
 * bill, current → next, using the real subscription. Where there is no price in
 * Stripe for the pack, the page says the price is not set rather than
 * inventing one and then disagreeing with the checkout.
 *
 * The exit is stated beside the buy, because reversibility is part of the
 * pitch.
 */
export default async function PackDetailPage({
  params,
}: PageProps<"/office/packs/[pack]">) {
  const { pack: packId } = await params;

  const pack = findPack(packId);
  if (!pack) notFound();

  const org = await requireActiveOrganization();
  const [packs, subscription] = await Promise.all([
    listPacks(org.id),
    getSubscription(org.id),
  ]);

  const state = packs.find((row) => row.pack.id === packId)!;

  const planCents = subscription?.price?.unitAmount ?? null;
  const ownedPackCents = packs
    .filter((row) => row.entitled && row.priceCents !== null)
    .reduce((sum, row) => sum + (row.priceCents ?? 0), 0);

  const currentCents =
    planCents === null ? null : planCents + ownedPackCents;
  const nextCents =
    currentCents === null || state.priceCents === null
      ? null
      : currentCents + state.priceCents;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`${pack.name} pack`}
        description={
          pack.status === "coming"
            ? "What this pack will add to the quote editor you already use. Nothing moves."
            : "Everything below is added to the quote editor you already use. Nothing moves."
        }
      />

      {/* Counted contents, never adjectives. This block is the answer to "is
          this real, or an upsell?" and it is the only thing that answers it. */}
      <div className="rounded-xl border">
        {pack.contents.map((row, index) => (
          <div
            key={row.title}
            className={`flex gap-4 px-5 py-4 ${index ? "border-t" : ""}`}
          >
            {/* The number column appears only where there is a number. A dash
                standing in for a count reads as a count nobody filled in. */}
            {row.count === null ? null : (
              <span className="w-8 shrink-0 text-lg font-semibold tabular-nums">
                {row.count}
              </span>
            )}
            <p className="text-sm">
              <strong className="font-medium">{row.title}</strong> — {row.detail}
            </p>
          </div>
        ))}
      </div>

      {state.entitled ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5">
          <div>
            <p className="font-medium">
              {state.enabled ? "This pack is on" : "You own this pack"}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {state.priceCents !== null
                ? `Billed at ${formatMoney(state.priceCents)}/mo`
                : "On your subscription"}
              {state.enabled
                ? ". New quotes use its templates."
                : ". It's switched off, so new quotes don't use its templates."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PackSwitch
              packId={pack.id}
              packName={pack.name}
              enabled={state.enabled}
            />
            {state.enabled ? (
              <Button asChild variant="outline">
                <Link href={`/office/packs/${pack.id}/configure`}>
                  Tune its defaults
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : pack.status === "coming" ? (
        <div className="rounded-xl border border-dashed p-5">
          <p className="font-medium">Not out yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            This pack is being built. Everything above is what it will ship
            with — nothing is sold until it does.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border p-5">
            <p className="text-muted-foreground font-label text-[10px] uppercase">
              Your bill
            </p>

            {currentCents === null || nextCents === null ? (
              // Honest rather than approximate. Showing a made-up "before and
              // after" on a page whose whole job is a total he recognises would
              // undo the page.
              <p className="text-muted-foreground mt-3 text-sm">
                We don&apos;t have a price for this pack yet, so there&apos;s no
                total to show you. Nothing here can be charged until there is.
              </p>
            ) : (
              <>
                <div className="mt-3 flex flex-col gap-1.5 text-sm">
                  {planCents !== null ? (
                    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                      <span>{subscription?.product?.name ?? "Plan"}</span>
                      <span className="tabular-nums">
                        {formatMoney(planCents)}
                      </span>
                    </div>
                  ) : null}
                  {packs
                    .filter((row) => row.entitled && row.priceCents !== null)
                    .map((row) => (
                      <div key={row.pack.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                        <span>{row.pack.name} pack</span>
                        <span className="tabular-nums">
                          {formatMoney(row.priceCents!)}
                        </span>
                      </div>
                    ))}
                  <div className="text-primary-ink flex flex-wrap justify-between gap-x-4 gap-y-1">
                    <span>{pack.name} pack</span>
                    <span className="tabular-nums">
                      +{formatMoney(state.priceCents!)}
                    </span>
                  </div>
                </div>

                <Separator className="my-3" />

                <div className="flex flex-wrap items-baseline gap-3 text-2xl font-semibold">
                  <span className="text-muted-foreground tabular-nums">
                    {formatMoney(currentCents)}
                  </span>
                  <span className="text-muted-foreground text-base font-normal">
                    →
                  </span>
                  <span className="tabular-nums">
                    {formatMoney(nextCents)}
                    <span className="text-muted-foreground text-sm font-normal">
                      /mo
                    </span>
                  </span>
                </div>

                <p className="text-muted-foreground mt-2 text-xs">
                  One bill, one card. Turn it off any time and it goes back to{" "}
                  {formatMoney(currentCents)} at the end of the month.
                </p>
              </>
            )}
          </div>

          {pack.stripePriceLookupKey && state.priceCents !== null ? (
            <CheckoutButton
              organizationId={org.id}
              priceId={pack.stripePriceLookupKey}
            >
              Add to my subscription
            </CheckoutButton>
          ) : null}

          <p className="text-muted-foreground text-xs">
            Two packs on means new quotes will ask which trade — defaulted to
            whichever you use most.
          </p>
        </>
      )}
    </div>
  );
}
