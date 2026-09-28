import type { Metadata } from "next";

import { PlanChooser } from "@/components/billing/plan-chooser";
import { PageHeader } from "@/components/page-header";
import { requireActiveOrganization } from "@/lib/dal";
import { getAccess } from "@/lib/membership/access";

export const metadata: Metadata = { title: "Change plan" };

/**
 * Screen 34 · change plan · Flow 12, job PS4 · Billing §5.2.
 *
 * **What it costs, and when, before it happens.** Anything that costs more
 * is previewed from Stripe at a fixed moment, paid, then granted; anything
 * that costs less waits for the renewal and says so. Nothing already sent is
 * touched either way.
 */
export default async function ChangePlanPage() {
  const org = await requireActiveOrganization();
  const access = await getAccess(org.id);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 sm:gap-10">
      <PageHeader
        title="Change plan"
        description="Upgrades and added packs start as soon as they're paid. Downgrades, removed packs and a new billing interval wait for your renewal — you keep what you have until then."
      />
      <PlanChooser organizationId={org.id} access={access} />
      <p className="text-muted-foreground rounded-xl border border-dashed p-5 text-sm">
        Jobs already in flight keep running and their share links stay live — your customer&apos;s experience
        doesn&apos;t change because your plan did.
      </p>
    </div>
  );
}
