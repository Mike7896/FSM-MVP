import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { dateOf } from "@/components/billing/bill-card";
import { ChangeButton } from "@/components/billing/change-button";
import { MembershipAction } from "@/components/billing/membership-action";
import { PageHeader } from "@/components/page-header";
import { PackSwitch } from "@/components/office/pack-switch";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization } from "@/lib/dal";
import { getAccess, type Access } from "@/lib/membership/access";
import { pickerPricing } from "@/lib/membership/bill";
import { PACK_IDS, POLICY, type PackId } from "@/lib/membership/catalog";
import { nextConfig } from "@/lib/membership/changes";
import { findPack } from "@/lib/packs/catalog";
import { formatMoney } from "@/lib/quote/money";

export const metadata: Metadata = { title: "Trade pack" };

/**
 * Screen 37 · pack detail · Flow 13, job TP2 · Billing §3.2, §4.
 *
 * Three separate things, said separately (§4.1): **buying** the pack (a line
 * on the bill, prorated and paid before it's granted), **evaluating** it (14
 * days, no card, once per business), and **showing** it (a visibility switch
 * that never buys or cancels anything). Removing it waits for the renewal, and
 * the page says when. A pack that isn't released isn't sold, whatever this
 * page says it will contain.
 */
export default async function PackDetailPage({
  params,
}: PageProps<"/office/packs/[pack]">) {
  const { pack: packId } = await params;

  const pack = findPack(packId);
  if (!pack) notFound();

  const org = await requireActiveOrganization();
  const [access, pricing] = await Promise.all([getAccess(org.id), pickerPricing(org.id)]);
  const sold = PACK_IDS.includes(pack.id as PackId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
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
      <div className="rounded-2xl border bg-card">
        {pack.contents.map((row, index) => (
          <div
            key={row.title}
            className={`flex gap-4 px-5 py-4 ${index ? "border-t" : ""}`}
          >
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

      {sold ? (
        <PackMembership
          packId={pack.id as PackId}
          name={pack.name}
          access={access}
          priceMonth={pricing.packs[pack.id as PackId].month}
          priceYear={pricing.packs[pack.id as PackId].year}
          released={pricing.electricalAvailable}
        />
      ) : (
        <div className="rounded-2xl border border-dashed bg-muted/30 p-6">
          <p className="font-medium">Not out yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            This pack is being built. Nothing is sold until it ships.
          </p>
        </div>
      )}
    </div>
  );
}

function PackMembership({
  packId,
  name,
  access,
  priceMonth,
  priceYear,
  released,
}: {
  packId: PackId;
  name: string;
  access: Access;
  priceMonth: number | null;
  priceYear: number | null;
  released: boolean;
}) {
  const state = access.packs[packId];
  const next = nextConfig(access);
  const paying = access.standing === "paid" || access.standing === "grace";
  const price = access.interval === "year" ? priceYear : priceMonth;
  const per = access.interval === "year" ? "/yr" : "/mo";

  // On the plan: show or hide it, and remove it at the renewal.
  if (state.purchased) {
    const leaving = state.endsAt;
    return (
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-medium">
              On your plan{price !== null ? ` · ${formatMoney(price)}${per}` : ""}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {leaving
                ? `Ends ${dateOf(leaving)} with your renewal. You keep it until then.`
                : `Renews with your plan${access.currentPeriodEnd ? ` on ${dateOf(access.currentPeriodEnd)}` : ""}.`}
            </p>
          </div>
          <PackSwitch packId={packId} packName={name} enabled={state.enabled} />
        </div>
        <p className="text-muted-foreground text-xs">
          Switching it off only hides it from your workspace — your subscription and your bill don&apos;t change.
        </p>
        {state.usable ? (
          <div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/office/packs/${packId}/configure`}>Tune its defaults</Link>
            </Button>
          </div>
        ) : null}
        {next && access.canChangePlan && !access.cancelAtPeriodEnd ? (
          <div>
            {leaving ? (
              <ChangeButton
                target={{ ...next, packs: [...new Set([...next.packs, packId])] }}
                label={`Keep ${name}`}
                variant="outline"
                size="sm"
              />
            ) : (
              <ChangeButton
                target={{ ...next, packs: next.packs.filter((pack) => pack !== packId) }}
                label={`Remove ${name} at renewal`}
                variant="outline"
                size="sm"
              />
            )}
          </div>
        ) : null}
      </div>
    );
  }

  if (!released) {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/30 p-6">
        <p className="font-medium">Not out yet</p>
        <p className="text-muted-foreground mt-1 text-sm">
          This pack is being built. Everything above is what it will ship with — nothing is sold, and no evaluation
          starts, until it does.
        </p>
      </div>
    );
  }

  const evaluation = state.evaluation;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-6 sm:p-8">
      <div>
        <p className="font-medium">
          {price !== null ? `${formatMoney(price)}${per}` : "Price not set"}
          <span className="text-muted-foreground font-normal"> · requires Starter or Pro</span>
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {paying
            ? "Added straight away, prorated to your renewal date. You'll see the exact amount before you confirm."
            : "It's a line on a Starter or Pro membership, renewing on the same date. The next screen shows the total."}
        </p>
      </div>

      {evaluation?.active ? (
        <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3 text-sm">
          <span>
            Evaluating until {dateOf(evaluation.expiresAt)} — no card, no automatic charge. Buying now ends the free
            days and starts the paid pack.
          </span>
          <PackSwitch packId={packId} packName={name} enabled={state.enabled} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {paying && next ? (
          access.canChangePlan ? (
            <ChangeButton
              target={{ ...next, packs: [...new Set([...next.packs, packId])] }}
              label={`Add ${name} to my plan`}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              Settle your renewal first — nothing new can be added until it&apos;s paid.
            </p>
          )
        ) : (
          <Button asChild>
            <Link href={`/upgrade/checkout?plan=starter&interval=month&pack=${packId}`}>
              Choose a plan with {name}
            </Link>
          </Button>
        )}

        {!state.evaluationUsed ? (
          <MembershipAction
            endpoint={`/api/v1/packs/${packId}/evaluation`}
            label={`Try it free for ${POLICY.evaluationDays} days`}
            success={`${name} is on for ${POLICY.evaluationDays} days. Nothing is charged when it ends.`}
            confirm={{
              title: `Try ${name} for ${POLICY.evaluationDays} days?`,
              lines: [
                `It starts now and ends on its own after ${POLICY.evaluationDays} days. No card, and nothing is charged.`,
                "It unlocks the pack's content only — your plan and its limits stay as they are.",
                "Each business gets one evaluation, so start it when you have work to try it on.",
                "Anything you write with it stays exactly as it is after it ends.",
              ],
              action: "Start the evaluation",
            }}
          />
        ) : !evaluation?.active ? (
          <span className="text-muted-foreground text-sm">
            Your {POLICY.evaluationDays}-day evaluation has been used.
          </span>
        ) : null}
      </div>
    </div>
  );
}
