import { PlanPicker } from "@/components/billing/plan-picker";
import type { Access } from "@/lib/membership/access";
import { pickerPricing } from "@/lib/membership/bill";
import { nextConfig } from "@/lib/membership/changes";
import { trialEndFor } from "@/lib/membership/checkout";

/**
 * The picker, set up for this shop: a Free shop goes to checkout; a paying
 * shop previews and confirms a change to what it already has (Billing §5.2).
 * Shared by `/upgrade` and `/account/billing/plan` so the two can't disagree.
 *
 * A shop still in a free period goes to checkout too, told the first charge
 * waits for the free time — the same date checkout gives Stripe.
 */
export async function PlanChooser({
  organizationId,
  access,
  returnPath,
}: {
  organizationId: string;
  access: Access;
  returnPath?: string;
}) {
  const pricing = await pickerPricing(organizationId);
  const paying = access.subscriptionId !== null && ["paid", "grace", "restricted"].includes(access.standing);

  if (!paying) {
    const trialEnd = trialEndFor(access, new Date());
    return (
      <PlanPicker
        pricing={pricing}
        mode={{ kind: "checkout", returnPath, firstChargeAt: trialEnd ? new Date(trialEnd * 1000).toISOString() : null }}
      />
    );
  }

  return (
    <PlanPicker
      pricing={pricing}
      mode={{
        kind: "change",
        current: nextConfig(access),
        canChange: access.canChangePlan,
        blockedReason: access.pending
          ? "A change is waiting for payment"
          : "Settle your renewal first",
      }}
    />
  );
}
