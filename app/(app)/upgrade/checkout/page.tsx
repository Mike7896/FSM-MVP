import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Lock } from "lucide-react";

import { dateOf } from "@/components/billing/bill-card";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { PageHeader } from "@/components/page-header";
import { Separator } from "@/components/ui/separator";
import { requireActiveOrganization } from "@/lib/dal";
import { getAccess } from "@/lib/membership/access";
import { billFor } from "@/lib/membership/bill";
import { TIER_LABEL, type BillingInterval, type PackId, type PaidTier } from "@/lib/membership/catalog";
import { foundingOfferFor } from "@/lib/membership/founding";
import { getReleases } from "@/lib/membership/releases";
import { safeNextPath } from "@/lib/safe-next";
import { formatMoney } from "@/lib/quote/money";

export const metadata: Metadata = { title: "Confirm and pay" };

/**
 * Screen 31 · checkout · Flow 11 · Billing §5.2, §12.
 *
 * **Card entry belongs to Stripe** — this is the bill they're about to agree
 * to, itemised, before the hosted page. Every amount is a Stripe price; the
 * founding price appears only when the server decided the shop qualifies.
 * Buying the pack during its evaluation says, before the button, that the
 * free days end when the paid ones begin.
 */
export default async function CheckoutPage({ searchParams }: PageProps<"/upgrade/checkout">) {
  const org = await requireActiveOrganization();
  const params = await searchParams;

  const tier: PaidTier = params.plan === "pro" ? "pro" : "starter";
  const interval: BillingInterval = params.interval === "year" ? "year" : "month";
  const packs: PackId[] = params.pack === "electrical" ? ["electrical"] : [];
  const next = safeNextPath(params.next, "");

  const [access, releases, founding] = await Promise.all([
    getAccess(org.id),
    getReleases(),
    foundingOfferFor(org.id),
  ]);

  // A shop that already pays changes its plan; it never checks out a second one.
  if (access.subscriptionId && ["paid", "grace", "restricted"].includes(access.standing)) {
    redirect("/account/billing/plan");
  }
  if ((tier === "pro" && !releases.pro) || (packs.length && !releases.pack_electrical)) {
    redirect("/upgrade");
  }

  const bill = await billFor({ tier, interval, packs }, founding.eligible);
  const per = interval === "year" ? "/yr" : "/mo";
  const evaluation = access.packs.electrical.evaluation;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-8">
      <PageHeader
        title="Confirm and pay"
        description={`${TIER_LABEL[tier]}${packs.length ? " + Electrical" : ""}, billed ${interval === "year" ? "yearly" : "monthly"}.${next ? " Your draft is saved — you'll land back in it." : ""}`}
      />

      <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        {bill.lines.map((line) => (
          <div key={line.label} className="flex justify-between py-1.5 text-sm">
            <span>{line.label}</span>
            <span className="tabular-nums">{line.cents === null ? "—" : `${formatMoney(line.cents)}${per}`}</span>
          </div>
        ))}

        <Separator className="my-6" />

        <div className="flex items-baseline justify-between">
          <span className="font-label text-[11px] uppercase">Your bill</span>
          <span className="text-4xl font-semibold tracking-tight tabular-nums">
            {bill.totalCents === null ? "—" : formatMoney(bill.totalCents)}
            <span className="text-muted-foreground text-sm font-normal">{per}</span>
          </span>
        </div>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
          Plus applicable tax, shown before you pay. Renews {interval === "year" ? "every year" : "every month"} on the
          same date until you cancel — you can cancel in Billing, and everything you&apos;ve built stays yours.
          {packs.length ? " The Electrical pack requires Starter or Pro and renews with it." : ""}
        </p>

        {founding.eligible ? (
          <p className="mt-3 text-sm">
            <strong className="font-medium">Founding-member pricing</strong> — founding core pricing while your paid
            membership stays active.
          </p>
        ) : null}

        {packs.length && evaluation?.active ? (
          <p className="bg-muted/50 mt-3 rounded-lg p-3 text-sm">
            Your free Electrical evaluation runs until {dateOf(evaluation.expiresAt)}. Paying now starts the paid pack
            straight away, and the rest of the free evaluation ends.
          </p>
        ) : null}
      </div>

      {bill.totalCents === null ? (
        <p className="text-muted-foreground text-sm">This plan isn&apos;t on sale here yet.</p>
      ) : (
        <CheckoutButton tier={tier} interval={interval} packs={packs} returnPath={next || undefined}>
          <Lock />
          Continue to payment
        </CheckoutButton>
      )}

      <p className="text-muted-foreground text-center text-xs">
        Card details are handled by Stripe — they never touch our servers.{" "}
        <Link href={next ? `/upgrade?next=${encodeURIComponent(next)}` : "/upgrade"} className="underline underline-offset-4">
          Back to plans
        </Link>
      </p>
    </div>
  );
}
