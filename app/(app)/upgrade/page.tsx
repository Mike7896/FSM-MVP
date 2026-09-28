import Link from "next/link";
import type { Metadata } from "next";

import { PlanGrid } from "@/components/billing/plan-grid";
import { PageHeader } from "@/components/page-header";
import { requireActiveOrganization } from "@/lib/dal";
import { getActivePlans, getSubscription } from "@/lib/queries/billing";
import { sentThisMonth } from "@/lib/queries/quotes";

export const metadata: Metadata = { title: "Choose a plan" };

/**
 * Screen 30 · the in-app plan picker · Flow 11.
 *
 * Plan selection lives in two places on purpose. `/pricing` on the marketing
 * site serves someone comparison-shopping before signup — full matrix,
 * objection handling. This one serves someone **mid-decision who wants
 * permission to stop deciding**: the same prices, their own usage as context.
 *
 * The rule the whole journey is subordinate to: **work in progress survives the
 * upgrade prompt, always.** A contractor who loses a half-built quote in front
 * of a customer does not upgrade — they uninstall, and they tell the forum. So
 * the draft is saved before they ever reach here, and the copy says so.
 *
 * The send count is real. "You've sent 3 quotes this month" is the whole reason
 * this screen is on their phone, and a made-up number is one they would notice.
 */
export default async function UpgradePage() {
  const org = await requireActiveOrganization();

  const [plans, subscription, sent] = await Promise.all([
    getActivePlans(),
    getSubscription(org.id),
    sentThisMonth(org.id),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
      <PageHeader
        title="Which one is you?"
        description={`${sentLine(sent)} Your draft is saved and ready — any paid plan sends it now.`}
      />

      <PlanGrid
        plans={plans}
        organizationId={org.id}
        currentPriceId={subscription?.price?.id ?? null}
      />

      <p className="text-muted-foreground text-sm">
        Trade packs are a separate line on the same bill — one membership,
        however many packs.{" "}
        <Link
          href="/office/packs"
          className="text-primary-ink underline underline-offset-4"
        >
          See the packs
        </Link>
      </p>
    </div>
  );
}

function sentLine(sent: number) {
  if (sent === 0) return "Nothing sent this month yet.";
  return `You've sent ${sent} quote${sent === 1 ? "" : "s"} this month.`;
}
