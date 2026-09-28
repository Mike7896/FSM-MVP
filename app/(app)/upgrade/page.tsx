import Link from "next/link";
import type { Metadata } from "next";

import { PlanChooser } from "@/components/billing/plan-chooser";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/page-header";
import { requireActiveOrganization } from "@/lib/dal";
import { getAccess } from "@/lib/membership/access";
import { getActivationUsage } from "@/lib/membership/activation";
import { safeNextPath } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Choose a plan" };

/**
 * Screen 30 · the in-app plan picker · Flow 11 · Billing §3.1.
 *
 * Serves someone **mid-decision who wants permission to stop deciding**: the
 * same prices as the pricing page, with their own usage as context.
 *
 * The rule the journey is subordinate to: **work in progress survives the
 * upgrade prompt, always.** The draft that hit the limit is saved before
 * anyone gets here, the copy says so, and `?next=` brings them back to it.
 * The count is real — "3 of 3 free jobs" is the reason this screen is on
 * their phone, and a made-up number is one they would notice.
 */
export default async function UpgradePage({ searchParams }: PageProps<"/upgrade">) {
  const org = await requireActiveOrganization();
  const params = await searchParams;
  const next = safeNextPath(params.next, "");
  const [access, usage] = await Promise.all([getAccess(org.id), getActivationUsage(org.id)]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <PageHeader
        title="A plan for your next chapter"
        description={
          usage.limit === null
            ? "Pick the plan that fits. Upgrades start as soon as they're paid."
            : `You've activated ${usage.used} of ${usage.limit} free jobs this month.${next ? " Your draft is saved — any paid plan sends it now." : ""}`
        }
      />

      {usage.limit !== null ? (
        <p className="text-muted-foreground -mt-4 text-sm">
          Or wait: your free jobs reset <LocalTime iso={usage.resetsAt.toISOString()} />.
          {next ? (
            <>
              {" "}
              <Link href={next} className="text-primary-ink underline underline-offset-4">Back to your draft</Link>
            </>
          ) : null}
        </p>
      ) : null}

      {params.checkout === "cancelled" ? (
        <p className="rounded-lg border px-4 py-3 text-sm">Checkout was cancelled. Nothing was charged.</p>
      ) : null}

      <PlanChooser organizationId={org.id} access={access} returnPath={next || undefined} />

      <p className="text-muted-foreground text-sm">
        Trade packs are a line on the same bill, never a second subscription.{" "}
        <Link href="/office/packs" className="text-primary-ink underline underline-offset-4">
          See the packs
        </Link>
      </p>
    </div>
  );
}
