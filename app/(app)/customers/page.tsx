import { TagFilters, TagBadges } from "@/components/tags/tag-controls";
import { listTags, tagsForRecords } from "@/lib/queries/tags";
import { parseTagFilter } from "@/lib/tags";
import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";

import { AddCustomerButton } from "@/components/customers/customer-actions";
import { DemoChip } from "@/components/demo-chip";
import { RecordList, RecordRow, RecordMetric } from "@/components/record-list";
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
import { listCustomers, listLeadSources } from "@/lib/queries/customers";
import { formatMoney } from "@/lib/quote";

export const metadata: Metadata = { title: "Customers" };

/**
 * The customer directory · class B.
 *
 * Documents reach the customer through the Job rather than directly, which is
 * what keeps the model a tree. A customer is made the first time a quote is
 * written for them, or added here ahead of any work.
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

  const [availableTags, recordTags, leadSources] = await Promise.all([
    listTags(org.id),
    tagsForRecords(org.id, "customer", customers.map((row) => row.id)),
    listLeadSources(org.id),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-(--workspace-max-width) flex-col gap-10">
      <PageHeader
        title="Customers"
        description="Everyone you work for, their details, and their jobs."
        actions={<AddCustomerButton leadSources={leadSources} />}
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
          placeholder="Search by name, company, phone, email or address"
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
                : "Add someone now, or they'll be added the first time you write a quote for them."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link href="/quotes/new">Write a quote</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <RecordList title={search || filters.tags || filters.tagMode === "untagged" ? "Search results" : "All customers"} count={customers.length}>
          {customers.map((customer) => (
            <RecordRow
              key={customer.id}
              href={`/customers/${customer.id}`}
              kind="customer"
              title={customer.name}
              description={[
                customer.companyName !== customer.name ? customer.companyName : null,
                customer.address ?? customer.phone ?? "No address on file",
              ].filter(Boolean).join(" · ")}
              badges={customer.demo ? <DemoChip /> : null}
              tags={<TagBadges tags={recordTags[customer.id] ?? []} />}
              metrics={<>
                <RecordMetric label="Jobs">{customer.jobCount}</RecordMetric>
                <RecordMetric label="Open balance" positive={customer.openBalanceCents < 0}><Balance cents={customer.openBalanceCents} /></RecordMetric>
                <RecordMetric label="Last job">{lastJob(customer.lastJobAt)}</RecordMetric>
              </>}
            />
          ))}
        </RecordList>
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
