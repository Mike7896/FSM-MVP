import Link from "next/link";
import type { Metadata } from "next";
import { Download } from "lucide-react";

import { dateOf } from "@/components/billing/bill-card";
import { MembershipAction } from "@/components/billing/membership-action";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { requireActiveOrganization } from "@/lib/dal";
import { getAccess } from "@/lib/membership/access";
import { PACK_LABEL, PACK_IDS, TIER_FEATURES } from "@/lib/membership/catalog";
import { countOpenJobs } from "@/lib/queries/jobs";

export const metadata: Metadata = { title: "Cancel" };

/**
 * Screen 35 · cancel and export · Flow 12, jobs PS5 and X1 · Billing §4.2, §5.
 *
 * At *Leave* a contractor feels either respect or resentment — no guilt copy,
 * no phone call, no hidden button. **Every consequence here is this
 * account's own and true**: the date is Stripe's, the packs are the ones
 * billed, the Free limit is the one Free really has, and the jobs in flight
 * keep running with their links live, because killing those punishes the
 * contractor's customer.
 *
 * Cancelling is scheduled for the period end and undoable until then (§5.2).
 */
export default async function CancelPage() {
  const org = await requireActiveOrganization();
  const [access, openJobs] = await Promise.all([getAccess(org.id), countOpenJobs(org.id)]);

  if (!access.subscriptionId || access.configuredTier === "free") {
    return (
      <Empty className="rounded-xl border">
        <EmptyHeader>
          <EmptyTitle>You&apos;re not on a paid plan</EmptyTitle>
          <EmptyDescription>There&apos;s nothing to cancel, and nothing is being charged.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link href="/account/billing">Back to billing</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const ends = access.currentPeriodEnd ? dateOf(access.currentPeriodEnd) : null;

  if (access.cancelAtPeriodEnd) {
    return (
      <Empty className="rounded-xl border">
        <EmptyHeader>
          <EmptyTitle>{ends ? `Your membership already ends ${ends}` : "Your membership is already ending"}</EmptyTitle>
          <EmptyDescription>Nothing changes until then, and you won&apos;t be charged again.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <MembershipAction
            endpoint="/api/v1/membership/resume"
            label="Keep my membership"
            success="Your membership carries on. Nothing new was charged."
            variant="default"
          />
        </EmptyContent>
      </Empty>
    );
  }

  const packs = PACK_IDS.filter((pack) => access.packs[pack].purchased);
  const free = TIER_FEATURES.free;
  const consequences = [
    {
      scope: "Until then",
      detail: `Nothing changes. You keep everything you've paid for${ends ? ` until ${ends}` : ""}, and you can undo this any time before then.`,
    },
    ...(packs.length
      ? [{
          scope: "Packs",
          detail: `${packs.map((pack) => PACK_LABEL[pack]).join(" and ")} ends with your plan — no pack is ever billed on its own.`,
        }]
      : []),
    {
      scope: openJobs === 0 ? "No open jobs" : `${openJobs} open job${openJobs === 1 ? "" : "s"}`,
      detail:
        openJobs === 0
          ? "Nothing is mid-flight, so nothing gets interrupted."
          : "Keep running to completion. Draws, change orders, invoices and payments on them all still work.",
    },
    {
      scope: "Live links",
      detail: "Every quote, contract and invoice link your customers hold stays live. They never see that anything changed.",
    },
    {
      scope: "After that",
      detail: `You're on Free: ${free.monthlyActivations} new jobs a month, the ServiceClerk footer on new documents, and ${Math.round(free.storageBytes / 1024 ** 3)} GB for attachments. Documents you've already sent keep the look they went out with.`,
    },
    {
      scope: "Your history",
      detail: "Stays where it is, and stays downloadable — quotes, jobs, contracts, invoices and payments, whenever you want them.",
    },
    ...(access.founding.price
      ? [{
          scope: "Founding price",
          detail: "Kept if you come back within 30 days of your membership ending. After that, rejoining is at the public price.",
        }]
      : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 sm:gap-10">
      <PageHeader title="Cancel your membership" description="Here's exactly what changes." />

      <div className="rounded-2xl border bg-card">
        {consequences.map((row, i) => (
          <div
            key={row.scope}
            className={`flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-6 ${i === 0 ? "" : "border-t"}`}
          >
            <span className="text-muted-foreground font-label w-32 shrink-0 text-[11px] uppercase">{row.scope}</span>
            <p className="text-sm">{row.detail}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4 rounded-2xl border bg-card p-6">
        <div>
          <p className="font-medium">Take your data first</p>
          <p className="text-muted-foreground mt-1 text-sm">
            It stays available after you cancel too — this is just the easy moment to do it.
          </p>
        </div>
        <Button asChild variant="outline" className="shrink-0">
          <Link href="/office/data">
            <Download />
            Export
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-end gap-3 border-t pt-5">
        <Button asChild variant="ghost">
          <Link href="/account/billing">Keep my plan</Link>
        </Button>
        <MembershipAction
          endpoint="/api/v1/membership/cancel"
          label="Cancel membership"
          variant="destructive"
          size="default"
          success={ends ? `Cancelled. Everything keeps working until ${ends}.` : "Cancelled."}
          confirm={{
            title: "Cancel your membership?",
            lines: [
              ends ? `It ends ${ends}, and you won't be charged again.` : "It ends at the end of this period, and you won't be charged again.",
              "Your jobs, documents and customer links are untouched.",
              "You can undo this any time before it ends.",
            ],
            action: "Cancel membership",
            destructive: true,
          }}
        />
      </div>
    </div>
  );
}
