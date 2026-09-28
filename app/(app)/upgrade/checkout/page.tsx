import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Lock } from "lucide-react";

import { CheckoutButton } from "@/components/billing/checkout-button";
import { PageHeader } from "@/components/page-header";
import { Separator } from "@/components/ui/separator";
import { requireActiveOrganization } from "@/lib/dal";
import { formatMoney } from "@/lib/quote";
import { getActivePlans } from "@/lib/queries/billing";
import { listPacks } from "@/lib/queries/office";

export const metadata: Metadata = { title: "Confirm and pay" };

/**
 * Screen 31 · checkout · Flow 11.
 *
 * **Card entry belongs to Stripe — the app never handles raw card details**, so
 * this page is the confirmation before the hosted session rather than a form
 * pretending to be one. What it owes the contractor is the bill they are about
 * to agree to, itemised against what they already own, with every figure read
 * from Stripe rather than assembled here.
 *
 * The failure branch that matters is not a declined card but a **lost draft**:
 * any navigation away from unsaved work reads as loss even when we saved it,
 * which is why the copy says where they land and the editor autosaves before
 * ever routing here.
 */
export default async function CheckoutPage({
  searchParams,
}: PageProps<"/upgrade/checkout">) {
  const org = await requireActiveOrganization();
  const { plan: requested } = await searchParams;

  const [plans, packs] = await Promise.all([
    getActivePlans(),
    listPacks(org.id),
  ]);

  const chosen =
    plans.find((row) => row.price.id === requested) ?? plans[0] ?? null;

  // Nothing to confirm without a plan to confirm. Back to the picker rather
  // than an empty page that looks broken.
  if (!chosen) redirect("/upgrade");

  const ownedPacks = packs.filter(
    (state) => state.entitled && state.priceCents !== null
  );
  const planCents = chosen.price.unitAmount ?? 0;
  const packCents = ownedPacks.reduce(
    (sum, state) => sum + (state.priceCents ?? 0),
    0
  );

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-8">
      <PageHeader
        title="Confirm and pay"
        description="Your draft is saved. You'll land back in it."
      />

      <div className="rounded-xl border p-5">
        <div className="flex justify-between py-1.5 text-sm">
          <span>{chosen.product.name} plan</span>
          <span className="tabular-nums">{formatMoney(planCents)}/mo</span>
        </div>

        {ownedPacks.map((state) => (
          <div
            key={state.pack.id}
            className="flex justify-between py-1.5 text-sm"
          >
            <span>{state.pack.name} pack</span>
            <span className="tabular-nums">
              {formatMoney(state.priceCents!)}/mo
            </span>
          </div>
        ))}

        <Separator className="my-3" />

        <div className="flex items-baseline justify-between">
          <span className="font-label text-[11px] uppercase">
            Your bill
          </span>
          <span className="text-2xl font-semibold tabular-nums">
            {formatMoney(planCents + packCents)}
            <span className="text-muted-foreground text-sm font-normal">
              /mo
            </span>
          </span>
        </div>

        <p className="text-muted-foreground mt-2 text-xs">
          One bill, one card. Cancel any time — everything you&apos;ve built
          stays exportable and every link you&apos;ve sent stays live.
        </p>
      </div>

      <CheckoutButton organizationId={org.id} priceId={chosen.price.id}>
        <Lock />
        Continue to payment
      </CheckoutButton>

      <p className="text-muted-foreground text-center text-xs">
        Card details are handled by Stripe — they never touch our servers.{" "}
        <Link href="/upgrade" className="underline underline-offset-4">
          Back to plans
        </Link>
      </p>
    </div>
  );
}
