import type { Metadata } from "next";

import { PlanGrid } from "@/components/billing/plan-grid";
import { PageHeader } from "@/components/page-header";
import { requireActiveOrganization } from "@/lib/dal";
import { getActivePlans, getSubscription } from "@/lib/queries/billing";

export const metadata: Metadata = { title: "Change plan" };

/**
 * Screen 34 · change plan · Flow 12, job PS4.
 *
 * **Proration in plain words, and the effective date stated.** Stripe does the
 * arithmetic; what this page owes the contractor is the sentence that says a
 * change lands on the next billing date and that nothing already sent is
 * affected — a downgrade must never let a feature quietly stop working next
 * month without having said so.
 */
export default async function ChangePlanPage() {
  const org = await requireActiveOrganization();

  const [plans, subscription] = await Promise.all([
    getActivePlans(),
    getSubscription(org.id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Change plan"
        description="Changes take effect on your next billing date. Nothing you've already sent is affected."
      />

      <PlanGrid
        plans={plans}
        organizationId={org.id}
        currentPriceId={subscription?.price?.id ?? null}
      />

      <p className="text-muted-foreground rounded-xl border border-dashed p-5 text-sm">
        Jobs already in flight keep running and their share links stay live —
        your customer&apos;s experience doesn&apos;t break because of a change to
        your plan.
      </p>
    </div>
  );
}
