import { RecordTagSection } from "@/components/tags/record-tags";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Mail, Phone, Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization } from "@/lib/dal";
import { DocumentRail } from "@/components/documents/document-rail";
import { getCustomer } from "@/lib/queries/customers";
import { listCustomerDocuments } from "@/lib/queries/job-documents";
import { getOfficeIdentity } from "@/lib/queries/office";
import { formatMoney } from "@/lib/quote";

export const metadata: Metadata = { title: "Customer" };

/**
 * One person, and the work you've done for them.
 *
 * **Their jobs are the content of this page**, not a sub-list on it. The
 * customer record itself is four fields; what a contractor came here for is
 * "which job was that, and what happened with it" — so the jobs carry their
 * derived money and the record carries only enough to phone them.
 */
export default async function CustomerPage({
  params,
}: PageProps<"/customers/[id]">) {
  const org = await requireActiveOrganization();
  const { id } = await params;

  // Scoped inside the query rather than filtered after: Drizzle bypasses RLS,
  // so another shop's customer must never come back at all.
  const customer = await getCustomer(id, org.id);
  if (!customer) notFound();

  const [documents, office] = await Promise.all([
    listCustomerDocuments(customer.id, org.id),
    getOfficeIdentity(org.id),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-(--workspace-max-width) flex-col gap-10">
      <PageHeader
        title={customer.name}
        description={customer.address ?? undefined}
        actions={
          <Button asChild>
            <Link href={`/quotes/new?customer=${customer.id}`}>
              <Plus />
              Quote a job
            </Link>
          </Button>
        }
      />

      <RecordTagSection organizationId={org.id} entity="customer" recordId={id} />

      <div className="flex flex-wrap gap-4">
        {customer.phone ? (
          <a
            href={`tel:${customer.phone}`}
            className="hover:bg-muted/50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors"
          >
            <Phone className="size-4" />
            {customer.phone}
          </a>
        ) : null}
        {customer.email ? (
          <a
            href={`mailto:${customer.email}`}
            className="hover:bg-muted/50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors"
          >
            <Mail className="size-4" />
            {customer.email}
          </a>
        ) : null}
        {customer.openBalanceCents !== 0 ? (
          <div className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">
              {customer.openBalanceCents > 0 ? "Open balance" : "In credit"}
            </span>
            <span className="font-medium tabular-nums">
              {formatMoney(Math.abs(customer.openBalanceCents))}
            </span>
          </div>
        ) : null}
      </div>

      {customer.notes ? (
        <p className="text-muted-foreground max-w-prose rounded-xl border p-5 text-sm leading-relaxed">
          {customer.notes}
        </p>
      ) : null}

      {/* **What she has actually been sent**, newest first.
          A document reaches a customer through the Job and never directly —
          that rule is what keeps the model a tree — so this is a view over
          their jobs rather than a second home for documents. It answers the
          question the jobs list below cannot: *what did I quote them last
          spring, and what did it say?* */}
      {documents.length > 0 ? (
        <section>
          <p className="text-muted-foreground mb-2 font-label text-[11px] uppercase">
            What you&apos;ve sent them
          </p>
          <DocumentRail
            documents={documents}
            businessName={office.businessName}
            license={office.license}
            customerName={customer.name}
          />
        </section>
      ) : null}

      {/* Jobs stay rows. **A job is not a document** — it is the container
          several hang off — so drawing one as a page would have to pick which
          page, and any answer to that is a lie. What identifies a job is its
          number, its address and where its money stands, which is what a row
          says well. */}
      <section>
        <p className="text-muted-foreground mb-2 font-label text-[11px] uppercase">
          Their jobs
        </p>
        {customer.jobs.length > 0 ? (
          customer.jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="hover:bg-muted/50 -mx-3 flex items-center justify-between gap-4 border-t px-3 py-4 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-muted-foreground text-xs tabular-nums">
                    #{job.number}
                  </span>
                  <span className="font-medium">
                    {job.name ?? "Untitled job"}
                  </span>
                  <Badge variant="secondary" className="capitalize">
                    {job.status.replace(/_/g, " ")}
                  </Badge>
                </div>
                {job.address ? (
                  <p className="text-muted-foreground mt-1 text-sm">
                    {job.address}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 font-medium tabular-nums">
                {formatMoney(job.money.totalCents)}
              </span>
            </Link>
          ))
        ) : (
          <p className="text-muted-foreground border-t py-4 text-sm">
            No jobs yet for this customer.
          </p>
        )}
      </section>
    </div>
  );
}
