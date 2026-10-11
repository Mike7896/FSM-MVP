import { RecordTagSection } from "@/components/tags/record-tags";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Mail, MapPin, MessageSquare, Phone, Plus } from "lucide-react";

import { EditCustomerButton } from "@/components/customers/customer-actions";
import { CustomerNotes } from "@/components/customers/customer-notes";
import { DemoChip } from "@/components/demo-chip";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization, requireSession } from "@/lib/dal";
import { DocumentRail } from "@/components/documents/document-rail";
import {
  getCustomer,
  listCustomerNotes,
  listLeadSources,
  type CustomerDetail,
} from "@/lib/queries/customers";
import { listCustomerDocuments } from "@/lib/queries/job-documents";
import { getOfficeIdentity } from "@/lib/queries/office";
import { formatMoney } from "@/lib/quote";

export const metadata: Metadata = { title: "Customer" };

/**
 * One customer: how to reach them, what you know about them, and the work
 * you've done for them.
 *
 * **Their jobs and money are derived, never stored on the record** — billed,
 * collected and open balance are folded from the job tree each time, so the
 * page cannot quietly disagree with an invoice.
 *
 * On a phone the contact card comes first, because the usual reason to open a
 * customer from the truck is to call them.
 */
export default async function CustomerPage({
  params,
}: PageProps<"/customers/[id]">) {
  const [org, session] = await Promise.all([
    requireActiveOrganization(),
    requireSession(),
  ]);
  const { id } = await params;

  // Scoped inside the query rather than filtered after: Drizzle bypasses RLS,
  // so another shop's customer must never come back at all.
  const customer = await getCustomer(id, org.id);
  if (!customer) notFound();

  const [documents, office, notes, leadSources] = await Promise.all([
    listCustomerDocuments(customer.id, org.id),
    getOfficeIdentity(org.id),
    listCustomerNotes(customer.id, org.id),
    listLeadSources(org.id),
  ]);

  // The company goes under the name only when the name is a person's — a
  // company-only customer's name already is the company.
  const subtitle =
    customer.companyName && customer.companyName !== customer.name
      ? customer.companyName
      : undefined;

  return (
    <div className="@container mx-auto flex w-full max-w-(--workspace-max-width) flex-col gap-8">
      <PageHeader
        title={customer.name}
        description={subtitle}
        actions={
          <>
            {customer.demo ? <DemoChip /> : null}
            <EditCustomerButton
              customer={{
                id: customer.id,
                name: customer.name,
                firstName: customer.firstName,
                lastName: customer.lastName,
                companyName: customer.companyName,
                email: customer.email,
                altEmail: customer.altEmail,
                phone: customer.phone,
                altPhone: customer.altPhone,
                preferredContact: customer.preferredContact,
                address: customer.address,
                billingAddress: customer.billingAddress,
                accessNotes: customer.accessNotes,
                leadSource: customer.leadSource,
                jobCount: customer.jobCount,
              }}
              leadSources={leadSources}
            />
            <Button asChild>
              <Link href={`/quotes/new?customer=${customer.id}`}>
                <Plus />
                Quote a job
              </Link>
            </Button>
          </>
        }
      />

      <RecordTagSection organizationId={org.id} entity="customer" recordId={id} />

      <div className="grid gap-8 @4xl:grid-cols-[minmax(0,1fr)_20rem] @4xl:gap-10">
        {/* First in the source so a phone shows it first; moved to the side
            column at desk width. */}
        <aside className="flex flex-col gap-4 @4xl:order-last">
          <ContactCard customer={customer} />
          <AddressCard customer={customer} />
          <DetailsCard customer={customer} />
        </aside>

        <div className="flex min-w-0 flex-col gap-10">
          <MoneySummary customer={customer} />

          <CustomerNotes
            customerId={customer.id}
            notes={notes}
            viewerId={session.userId}
            canManage={org.role === "owner" || org.role === "admin"}
          />

          {/* **What they have actually been sent**, newest first.
              A document reaches a customer through the Job and never directly —
              that rule is what keeps the model a tree — so this is a view over
              their jobs rather than a second home for documents. */}
          {documents.length > 0 ? (
            <section>
              <SectionLabel>What you&apos;ve sent them</SectionLabel>
              <DocumentRail
                documents={documents}
                businessName={office.businessName}
                license={office.license}
                customerName={customer.name}
              />
            </section>
          ) : null}

          {/* Jobs stay rows. **A job is not a document** — it is the container
              several hang off — so what identifies one is its number, its
              address and where its money stands. */}
          <section>
            <SectionLabel>
              Their jobs
              {customer.jobs.length ? (
                <span className="tabular-nums"> · {customer.jobs.length}</span>
              ) : null}
            </SectionLabel>
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
                    <p className="text-muted-foreground mt-1 text-sm">
                      <LocalTime
                        iso={new Date(job.createdAt).toISOString()}
                        format="date"
                      />
                      {job.address ? ` · ${job.address}` : ""}
                    </p>
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
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground mb-2 font-label text-[11px] uppercase">
      {children}
    </p>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4">
      <p className="text-muted-foreground mb-3 font-label text-[11px] uppercase">
        {title}
      </p>
      {children}
    </section>
  );
}

/**
 * Lifetime money, from the ledger and the invoices. Billed is what was sent;
 * collected is what arrived; the balance is the difference, and a negative one
 * is shown as credit rather than hidden behind a zero.
 */
function MoneySummary({ customer }: { customer: CustomerDetail }) {
  const balance = customer.openBalanceCents;
  const tiles = [
    { label: "Billed", value: formatMoney(customer.billedCents) },
    { label: "Collected", value: formatMoney(customer.collectedCents) },
    {
      label: balance < 0 ? "In credit" : "Open balance",
      value: formatMoney(Math.abs(balance)),
      emphasis: balance > 0,
    },
    { label: "Jobs", value: String(customer.jobCount) },
  ];

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border @lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-background px-4 py-3">
          <dt className="text-muted-foreground text-xs">{tile.label}</dt>
          <dd
            className={`mt-1 text-lg font-semibold tabular-nums ${tile.emphasis ? "text-primary-ink" : ""}`}
          >
            {tile.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const PREFERRED_LABEL = { call: "Prefers a call", text: "Prefers a text", email: "Prefers email" };

function ContactCard({ customer }: { customer: CustomerDetail }) {
  const phones = [customer.phone, customer.altPhone].filter(
    (phone): phone is string => Boolean(phone)
  );
  const emails = [customer.email, customer.altEmail].filter(
    (email): email is string => Boolean(email)
  );

  return (
    <Card title="Contact">
      {customer.preferredContact ? (
        <Badge variant="secondary" className="mb-3">
          {PREFERRED_LABEL[customer.preferredContact]}
        </Badge>
      ) : null}

      {phones.length === 0 && emails.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No phone or email yet. Add them with Edit.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {phones.map((phone, index) => (
            <li key={phone} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium tabular-nums">{phone}</p>
                <p className="text-muted-foreground text-xs">
                  {index === 0 ? "Phone" : "Other phone"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button asChild variant="outline" size="icon" className="size-8">
                  <a href={`tel:${phone}`} aria-label={`Call ${phone}`}>
                    <Phone />
                  </a>
                </Button>
                <Button asChild variant="outline" size="icon" className="size-8">
                  <a href={`sms:${phone}`} aria-label={`Text ${phone}`}>
                    <MessageSquare />
                  </a>
                </Button>
              </div>
            </li>
          ))}
          {emails.map((email, index) => (
            <li key={email} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{email}</p>
                <p className="text-muted-foreground text-xs">
                  {index === 0 ? "Email · documents go here" : "Other email"}
                </p>
              </div>
              <Button asChild variant="outline" size="icon" className="size-8 shrink-0">
                <a href={`mailto:${email}`} aria-label={`Email ${email}`}>
                  <Mail />
                </a>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AddressCard({ customer }: { customer: CustomerDetail }) {
  return (
    <Card title="Address">
      {customer.address ? (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium [overflow-wrap:anywhere]">{customer.address}</p>
            <p className="text-muted-foreground text-xs">Service address</p>
          </div>
          <Button asChild variant="outline" size="icon" className="size-8 shrink-0">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address)}`}
              target="_blank"
              rel="noreferrer"
              aria-label="Open in Maps"
            >
              <MapPin />
            </a>
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No service address yet.</p>
      )}

      <div className="mt-3 border-t pt-3">
        <p className="text-sm [overflow-wrap:anywhere]">
          {customer.billingAddress ?? (
            <span className="text-muted-foreground">Same as service address</span>
          )}
        </p>
        <p className="text-muted-foreground text-xs">Billing address</p>
      </div>

      {customer.accessNotes ? (
        <div className="mt-3 border-t pt-3">
          <p className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
            {customer.accessNotes}
          </p>
          <p className="text-muted-foreground text-xs">Property access</p>
        </div>
      ) : null}
    </Card>
  );
}

function DetailsCard({ customer }: { customer: CustomerDetail }) {
  return (
    <Card title="Details">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Found you by</dt>
        <dd className="text-right [overflow-wrap:anywhere]">
          {customer.leadSource ?? <span className="text-muted-foreground">—</span>}
        </dd>
        <dt className="text-muted-foreground">Customer since</dt>
        <dd className="text-right">
          <LocalTime iso={new Date(customer.createdAt).toISOString()} format="date" />
        </dd>
        <dt className="text-muted-foreground">Last job</dt>
        <dd className="text-right">
          {customer.lastJobAt ? (
            <LocalTime iso={new Date(customer.lastJobAt).toISOString()} format="date" />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </dd>
      </dl>
    </Card>
  );
}
