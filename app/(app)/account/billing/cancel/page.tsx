import Link from "next/link";
import type { Metadata } from "next";
import { Download } from "lucide-react";

import { CancelSubscriptionButton } from "@/components/billing/manage-billing-button";
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
import { getSubscription } from "@/lib/queries/billing";
import { countOpenJobs } from "@/lib/queries/jobs";

export const metadata: Metadata = { title: "Cancel" };

/**
 * Screen 35 · cancel and export · Flow 12, jobs PS5 and X1.
 *
 * At *Leave* a contractor feels either respect or resentment, with almost
 * nothing in between — and this buyer talks to other contractors in forums, so
 * a hostile exit costs more than the saved subscription. No guilt copy, no
 * phone-call requirement, no hidden button.
 *
 * The consequence that matters most is not ours: **jobs in flight have live
 * homeowner links.** Killing those punishes the contractor's customer and
 * damages *their* reputation, not ours. Open jobs land safely.
 *
 * **Every line here is this account's own.** The job count is counted, the date
 * is the one Stripe holds, and a consequence the product cannot honour yet —
 * the free plan's send cap, an export — is not stated. A leaving page that
 * promises what does not exist is the one page nobody forgives.
 */
export default async function CancelPage() {
  const org = await requireActiveOrganization();

  const [subscription, openJobs] = await Promise.all([
    getSubscription(org.id),
    countOpenJobs(org.id),
  ]);

  // Nothing to cancel. Reached by URL, or by a second tab after it was already
  // done — either way, say so rather than drawing consequences of nothing.
  if (!subscription) {
    return (
      <Empty className="rounded-xl border">
        <EmptyHeader>
          <EmptyTitle>You&apos;re not on a paid plan</EmptyTitle>
          <EmptyDescription>
            There&apos;s nothing to cancel, and nothing is being charged.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link href="/account/billing">Back to billing</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const { status, cancelAtPeriodEnd, currentPeriodEnd } =
    subscription.subscription;
  const ends = currentPeriodEnd ? formatDate(currentPeriodEnd) : null;

  if (cancelAtPeriodEnd) {
    return (
      <Empty className="rounded-xl border">
        <EmptyHeader>
          <EmptyTitle>
            {ends
              ? `Your subscription already ends ${ends}`
              : "Your subscription is already ending"}
          </EmptyTitle>
          <EmptyDescription>
            Nothing changes until then, and you won&apos;t be charged again.
            You can start it up again from billing whenever you want.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link href="/account/billing">Back to billing</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const consequences = [
    {
      scope:
        openJobs === 0
          ? "No open jobs"
          : `${openJobs} open job${openJobs === 1 ? "" : "s"}`,
      detail:
        openJobs === 0
          ? "Nothing is mid-flight, so nothing gets interrupted."
          : "Keep running to completion. Draws, invoices and change orders on them work normally.",
    },
    {
      scope: "Live links",
      detail:
        "Every quote, contract and invoice link your customers hold stays live. They never see that anything changed.",
    },
    {
      scope: "Your history",
      detail:
        "Stays where it is, and stays downloadable. Quotes, jobs, contracts, invoices and payments, as spreadsheets, whenever you want them.",
    },
    {
      scope: "The charge",
      detail:
        status === "trialing"
          ? ends
            ? `Never happens. Your trial runs to ${ends} and no card is charged.`
            : "Never happens. Your trial runs out and no card is charged."
          : ends
            ? `Stops on ${ends}, the end of this billing month. You're not billed again.`
            : "Stops at the end of this billing month. You're not billed again.",
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Cancel your subscription"
        description="Here's exactly what changes."
      />

      <div className="rounded-lg border">
        {consequences.map((row, i) => (
          <div
            key={row.scope}
            className={`flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-6 ${
              i === 0 ? "" : "border-t"
            }`}
          >
            <span className="text-muted-foreground w-32 shrink-0 font-label text-[11px] uppercase">
              {row.scope}
            </span>
            <p className="text-sm">{row.detail}</p>
          </div>
        ))}
      </div>

      {/* Export is offered first, deliberately — and it is a real download,
          available now and after, not a promise about later. */}
      <div className="flex items-center justify-between gap-4 rounded-lg border p-5">
        <div>
          <p className="font-medium">Take your data first</p>
          <p className="text-muted-foreground mt-1 text-sm">
            It stays available after you cancel too — this is just the easy
            moment to do it.
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
        {/* Cancelling itself happens on Stripe's own screen — one hand-off,
            with its confirmation, rather than a button of ours that ends a
            subscription on a single click. */}
        <CancelSubscriptionButton
          organizationId={org.id}
          subscriptionId={subscription.subscription.id}
        />
      </div>
    </div>
  );
}

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
