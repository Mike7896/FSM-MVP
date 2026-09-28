import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { requireActiveOrganization } from "@/lib/dal";
import { listJobs } from "@/lib/queries/jobs";
import { formatMoney } from "@/lib/quote";

export const metadata: Metadata = { title: "New invoice" };

/**
 * Invoice with no source Contract — *bill somebody*, reached cold.
 *
 * This route is the composability rule made reachable: **no document object may
 * depend on another document existing.** Until these doors existed an Invoice
 * could only be reached through a Contract and a Contract only by accepting a
 * Quote, which is a pipeline wearing an object model.
 *
 * **What it collects is picking the work, not writing the bill.** Every invoice
 * belongs to a Job — that is the one prerequisite anywhere — so this surface
 * answers "which job" and then hands off to `/jobs/[id]/invoices/new`, where the
 * contract's math is already applied if there is one. A second, subtly
 * different bill form here would be two places to get the same arithmetic
 * wrong.
 *
 * The *held* decision is what a document created from genuinely nothing
 * collects. That is why there is no "bill with no job" path yet: a Job is
 * created silently by whichever document comes first, and until that flow is
 * settled the honest door is this one.
 */
export default async function NewInvoicePage({
  searchParams,
}: PageProps<"/invoices/new">) {
  const org = await requireActiveOrganization();
  const { q } = await searchParams;
  const search = typeof q === "string" && q.trim() ? q.trim() : undefined;

  const jobs = await listJobs(org.id, { q: search, limit: 20 });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        title="New invoice"
        description="Which job is this for? Everything else follows from that."
      />

      <form className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          name="q"
          defaultValue={search ?? ""}
          placeholder="Customer, work, or address"
          className="pl-8"
        />
      </form>

      {jobs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {search ? "Nothing matched that." : "No jobs to bill yet"}
            </EmptyTitle>
            <EmptyDescription>
              A job is created the moment you write the first quote for it, so
              start there and the bill has somewhere to live.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/quotes/new">Write a quote</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col">
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}/invoices/new`}
              className="hover:bg-muted/50 -mx-3 flex items-center justify-between gap-4 border-t px-3 py-4 transition-colors"
            >
              <div className="min-w-0">
                <p className="font-medium">{job.customerName}</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {[job.name, job.address].filter(Boolean).join(" · ") ||
                    `Job #${job.number}`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-muted-foreground text-xs">Left to collect</p>
                <p className="font-medium tabular-nums">
                  {formatMoney(job.money.remainingCents)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
