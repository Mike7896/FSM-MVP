import { TagFilters, TagBadges } from "@/components/tags/tag-controls";
import { listTags, tagsForRecords } from "@/lib/queries/tags";
import { parseTagFilter } from "@/lib/tags";
import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";

import { DemoChip } from "@/components/demo-chip";
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
import { listCustomers } from "@/lib/queries/customers";
import { formatMoney } from "@/lib/quote";

export const metadata: Metadata = { title: "Customers" };

/**
 * The customer directory · class B.
 *
 * Customer is deliberately thin: **a directory for finding jobs by person, not
 * a parallel hierarchy.** Documents reach the customer through the Job rather
 * than directly, which is what keeps the model a tree.
 *
 * Sorted by most recent work rather than alphabetically. A contractor opens
 * this to find someone he is dealing with, not to read a phone book.
 */
export default async function CustomersPage({
  searchParams,
}: PageProps<"/customers">) {
  const org = await requireActiveOrganization();
  const filters = parseTagFilter(await searchParams);
  const { q } = await searchParams;
  const search = typeof q === "string" && q.trim() ? q.trim() : undefined;

  const customers = await listCustomers(org.id, { ...filters, q: search });

  const [availableTags, recordTags] = await Promise.all([listTags(org.id), tagsForRecords(org.id, "customer", customers.map(row => row.id))]);
  return (
    <div className="mx-auto flex w-full max-w-(--workspace-max-width) flex-col gap-10">
      <PageHeader
        title="Customers"
        description="Find a job by the person it's for."
      />

      {/* A GET form, so a search is a URL — shareable, back-button-safe, and
          working before the JavaScript has loaded. */}
      <form className="relative -mb-4 max-w-sm">
          {filters.tags && <input type="hidden" name="tags" value={filters.tags} />}
          {filters.tagMode && <input type="hidden" name="tagMode" value={filters.tagMode} />}
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          name="q"
            aria-label="Search customers"
          defaultValue={search ?? ""}
          placeholder="Name, phone, or address"
          className="pl-8"
        />
      </form>

      <TagFilters organizationId={org.id} available={availableTags} />

      {customers.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {(search || filters.tags || filters.tagMode === "untagged") ? "Nobody matched that." : "No customers yet"}
            </EmptyTitle>
            <EmptyDescription>
              {(search || filters.tags || filters.tagMode === "untagged")
                ? "Try changing the search or clearing the tag filters."
                : "A customer is created the first time you write a quote for them — there's nothing to set up here first."}
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
          {customers.map((customer) => (
            <Link
              key={customer.id}
              href={`/customers/${customer.id}`}
              className="hover:bg-muted/50 -mx-3 flex flex-col gap-3 border-t px-3 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-8"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  {customer.name}
                  {customer.demo ? <DemoChip /> : null}
                </p>
                <TagBadges tags={recordTags[customer.id] ?? []} />
                <p className="text-muted-foreground mt-1.5 text-sm">
                  {customer.address ?? customer.phone ?? "No address on file"}
                </p>
              </div>
              <div className="flex shrink-0 gap-8 text-sm sm:text-right">
                <div>
                  <p className="text-muted-foreground text-xs">Jobs</p>
                  <p className="mt-1 font-medium tabular-nums">
                    {customer.jobCount}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Open balance</p>
                  <div className="mt-1">
                    <Balance cents={customer.openBalanceCents} />
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Last job</p>
                  <p className="mt-1 font-medium">{lastJob(customer.lastJobAt)}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A negative balance is shown as credit rather than hidden behind a zero. An
 * overpayment is a real state, and one nobody notices is one that gets refunded
 * twice or never.
 */
function Balance({ cents }: { cents: number }) {
  if (cents < 0) {
    return (
      <p className="font-medium tabular-nums">
        {formatMoney(-cents)} <span className="text-muted-foreground">credit</span>
      </p>
    );
  }
  return <p className="font-medium tabular-nums">{formatMoney(cents)}</p>;
}

function lastJob(at: Date | null) {
  if (!at) return "—";
  const date = at instanceof Date ? at : new Date(at);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
