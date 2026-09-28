import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  CalendarClock,
  ChevronRight,
  ExternalLink,
  FilePlus2,
  FileSignature,
  FileText,
} from "lucide-react";

import { ChangeOrderActions } from "@/components/change-orders/actions";
import { ChangeOrderEditor } from "@/components/change-orders/editor";
import { inkFor } from "@/components/documents/ink";
import {
  IntegrityNote,
  SignatureLine,
  Timeline,
  activitySteps,
  inOrder,
  type TimelineStep,
} from "@/components/documents/standing";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentUser, requireActiveOrganization } from "@/lib/dal";
import { agreedChangeTargets, readChangeOrder } from "@/lib/change-orders/service";
import { listCaptures } from "@/lib/queries/captures";
import { changeOrderInvoice } from "@/lib/queries/change-orders";
import { getJobContract } from "@/lib/queries/contracts";
import { documentActivity } from "@/lib/queries/document-activity";
import { getOfficeIdentity, getOfficeSignature } from "@/lib/queries/office";
import {
  baseTotal,
  draftFromRecord,
  formatChange,
  formatMoney,
  isText,
  totals,
} from "@/lib/quote";
import { certificateFor } from "@/lib/signing/certificate";
import { cn } from "@/lib/utils";

import styles from "../../../jobs.module.css";

export const metadata: Metadata = { title: "Change order" };

/**
 * One change order — being written, or where it stands once it's gone out.
 *
 * **A draft is the editor**, full bleed like the quote's. **Once it's sent
 * it's the record**, laid out like the contract's overview, because it is the
 * same kind of thing: a signed agreement to a change, with a customer's answer
 * to wait for and money that follows from it. What it changes and by how much
 * lead; then who has signed, what has happened, and — once approved — how it
 * gets paid for.
 */
export default async function ChangeOrderPage({
  params,
}: PageProps<"/jobs/[id]/change-orders/[changeId]">) {
  const org = await requireActiveOrganization();
  const { id, changeId } = await params;
  const loaded = await readChangeOrder(changeId, org.id);
  if (loaded.doc.jobId !== id) notFound();
  const { doc } = loaded;
  const contract = await getJobContract(id, org.id);
  if (!contract) notFound();

  // A draft is still being written: the editor, full bleed like the quote's,
  // drawing its own bar and columns to the edges of the content region.
  if (doc.status === "draft") {
    const [captures, targets, office, signature, profile] = await Promise.all([
      listCaptures(id, org.id),
      agreedChangeTargets(contract.id, org.id),
      getOfficeIdentity(org.id),
      getOfficeSignature(org.id),
      getCurrentUser(),
    ]);
    return (
      <div className="-m-4 flex min-h-0 flex-1 flex-col md:-m-6">
        <ChangeOrderEditor
          captures={captures}
          targets={targets}
          loaded={loaded}
          initial={draftFromRecord(loaded.record)}
          office={office}
          parentContractId={doc.details!.parentContractId}
          agreedPriceCents={contract.currentPriceCents}
          contractNumber={contract.number}
          signerName={signature?.printedName ?? profile?.fullName ?? null}
          customerEmail={contract.customerEmail}
        />
      </div>
    );
  }

  const [activity, certificate, invoice] = await Promise.all([
    documentActivity(doc.id),
    certificateFor(doc.id, org.id),
    changeOrderInvoice(doc.id, org.id),
  ]);

  const details = doc.details!;
  const first = firstName(contract.customerName);
  const draft = draftFromRecord(loaded.record);
  const sums = totals(draft);
  const rows = draft.scope.filter((node) => !isText(node));
  const notes = draft.scope.filter(
    (node) => isText(node) && node.description.trim()
  );

  const delta = details.deltaCents;
  const approved = doc.status === "approved";
  const declined = doc.status === "declined";
  // What it was measured against when it went out; failing that, the contract
  // as it stands, less this change if it's already in it.
  const before =
    details.baseAmountCents ??
    (approved ? contract.currentPriceCents - delta : contract.currentPriceCents);
  const supplemental = details.billingMode === "supplemental";

  const signatures = certificate?.signatures ?? [];
  const contractor = signatures.find((entry) => entry.party === "contractor");
  const customer = signatures.find((entry) => entry.party === "customer");

  const status = approved ? "Approved" : declined ? "Declined" : `Waiting on ${first}`;
  const title = doc.title?.trim() || details.whatChanged?.trim() || "Change order";

  // The story, oldest first.
  const done: TimelineStep[] = [
    { at: doc.createdAt, label: "You wrote it" },
    ...(contractor
      ? [{ at: contractor.signedAt, label: "You signed and sent it" }]
      : []),
    ...activitySteps({ sends: activity.sends, visits: activity.visits, who: first }),
    ...(customer && approved
      ? [{ at: customer.signedAt, label: `${first} approved it`, detail: "Signed" }]
      : []),
    ...(declined
      ? [{ at: doc.updatedAt, label: `${first} declined it`, detail: "The contract is unchanged" }]
      : []),
    ...(invoice
      ? [{ at: invoice.createdAt, label: `Billed on ${invoice.number}` }]
      : []),
  ];
  const ahead: TimelineStep[] = [
    ...(doc.status === "sent" ? [{ at: null, label: `${first}'s answer` }] : []),
    ...(approved && supplemental && delta > 0 && !invoice
      ? [{ at: null, label: "Its own invoice" }]
      : []),
  ];

  return (
    <div className={`@container ${styles.page}`}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
        <Link href="/jobs">Jobs</Link>
        <ChevronRight size={13} />
        <Link href={`/jobs/${id}`}>Job #{contract.jobNumber}</Link>
        <ChevronRight size={13} />
        <Link href={`/jobs/${id}/contract`}>Contract</Link>
        <ChevronRight size={13} />
        <Link href={`/jobs/${id}/change-orders`}>Change orders</Link>
        <ChevronRight size={13} />
        <span>{doc.number}</span>
      </nav>

      <section className={styles.overview} aria-label="Change order overview">
        <header className={styles.jobHeader}>
          <div className="min-w-0">
            <p className={cn(styles.eyebrow, "flex items-center gap-2")}>
              <span
                className={cn("size-1.5 rounded-full", inkFor("Change order").dot)}
              />
              CHANGE ORDER · {doc.number} · AMENDS {contract.number}
            </p>
            <h1 className={styles.jobTitle}>{title}</h1>
            <div className={styles.jobMeta}>
              <Link
                href={`/customers/${contract.customerId}`}
                className={styles.customerLink}
              >
                {contract.customerName}
              </Link>
              {doc.sentAt ? (
                <span>
                  Sent <LocalTime iso={doc.sentAt.toISOString()} format="date" />
                </span>
              ) : null}
              {approved && details.approvedAt ? (
                <span>
                  Approved{" "}
                  <LocalTime iso={details.approvedAt.toISOString()} format="date" />
                </span>
              ) : null}
            </div>
          </div>
          <div className={styles.jobIdentity}>
            <span className={styles.jobIcon} aria-hidden="true">
              <FileSignature size={25} strokeWidth={1.5} />
            </span>
            <Badge
              variant={approved ? "default" : declined ? "destructive" : "secondary"}
              className={cn(!declined && styles.status)}
            >
              {status}
            </Badge>
          </div>
        </header>

        <div className={styles.moneyStrip}>
          <Figure label="Contract before" value={formatMoney(before)} />
          <Figure label="This change" value={formatChange(delta)} />
          <Figure
            label={declined ? "Contract, unchanged" : approved ? "Contract after" : "If approved"}
            value={formatMoney(declined ? before : before + delta)}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <ChangeOrderActions
            id={doc.id}
            jobId={id}
            status={invoice ? "billed" : doc.status}
            supplemental={supplemental && delta > 0}
          />
          {invoice ? (
            <Button asChild>
              <Link href={`/invoices/${invoice.id}`}>
                <FileText />
                Open invoice {invoice.number}
              </Link>
            </Button>
          ) : null}
          {activity.url ? (
            <Button asChild variant="outline">
              <a href={activity.url} target="_blank" rel="noreferrer">
                <ExternalLink />
                View what {first} sees
              </a>
            </Button>
          ) : null}
          {contract.status === "signed" ? (
            <Button asChild variant="outline">
              <Link href={`/jobs/${id}/change-orders/new`}>
                <FilePlus2 />
                Write another change
              </Link>
            </Button>
          ) : null}
        </div>
      </section>

      <div className={styles.detailGrid}>
        <div className={styles.mainColumn}>
          <section className={styles.panel}>
            <SectionLabel>What&apos;s changing</SectionLabel>
            {doc.summary?.trim() ? (
              <p className="border-t pt-4 text-sm leading-relaxed whitespace-pre-wrap">
                {doc.summary}
              </p>
            ) : null}

            {rows.length > 0 ? (
              <ul className="mt-4">
                {rows.map((node) => (
                  <li
                    key={node.key}
                    className="flex items-baseline justify-between gap-3 border-t py-2.5 text-sm"
                  >
                    <span className="min-w-0">
                      {node.description || "Untitled line"}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatChange(baseTotal(node))}
                    </span>
                  </li>
                ))}
                {sums.taxCents !== 0 ? (
                  <li className="text-muted-foreground flex items-baseline justify-between gap-3 border-t py-2.5 text-sm">
                    <span>Tax</span>
                    <span className="tabular-nums">{formatChange(sums.taxCents)}</span>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="text-muted-foreground mt-4 border-t pt-4 text-sm">
                No priced lines — a change to the schedule or the scope only.
              </p>
            )}

            {notes.length > 0 ? (
              <ul className="text-muted-foreground mt-2 space-y-1 text-sm">
                {notes.map((node) => (
                  <li key={node.key}>{node.description}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-2 flex items-baseline justify-between gap-3 border-t pt-3">
              <span className="font-label text-[11px] uppercase">This change</span>
              <span className="text-2xl font-semibold tabular-nums">
                {formatChange(delta)}
              </span>
            </div>
          </section>

          <section className={styles.panel}>
            <div className="flex items-baseline justify-between gap-2">
              <SectionLabel>Signatures</SectionLabel>
              <span className="text-muted-foreground text-xs">
                {[contractor, customer].filter(Boolean).length} of 2
              </span>
            </div>
            <SignatureLine
              label={`For ${contract.businessName ?? "your business"}`}
              signature={contractor}
              pending="Not signed."
            />
            <SignatureLine
              label="Customer"
              signature={customer}
              pending={
                declined
                  ? `${first} declined it, so there's nothing to sign.`
                  : `Waiting on ${first}. Their link is ready to approve.`
              }
            />
            <IntegrityNote signatures={signatures} />
          </section>

          <section className={styles.panel}>
            <SectionLabel>What&apos;s happened</SectionLabel>
            <Timeline steps={[...inOrder(done), ...ahead]} />
          </section>
        </div>

        <aside className={styles.sideColumn}>
          <section className={styles.panel}>
            <SectionLabel>Schedule</SectionLabel>
            <p className="flex items-center gap-2 border-t pt-4 text-sm">
              <CalendarClock className="text-muted-foreground size-4" />
              {scheduleWords(details.timeImpactDays ?? 0)}
            </p>
          </section>

          <section className={styles.panel}>
            <SectionLabel>Billing</SectionLabel>
            <div className="border-t pt-4">
              <p className="text-sm font-medium">
                {supplemental ? "On its own invoice" : "With the next payment"}
              </p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {declined
                  ? "Nothing to bill — it was declined."
                  : invoice
                    ? `Billed on ${invoice.number}.`
                    : supplemental
                      ? approved
                        ? "Approved and ready to bill."
                        : "Billed separately once it's approved."
                      : delta < 0
                        ? "Taken off the next unbilled draw, or the final balance."
                        : "Added to the next unbilled draw, or the final balance."}
              </p>
              {invoice ? (
                <Link
                  href={`/invoices/${invoice.id}`}
                  className="text-muted-foreground hover:text-foreground mt-3 inline-block text-xs underline underline-offset-4"
                >
                  Open invoice {invoice.number}
                </Link>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function scheduleWords(days: number) {
  if (days === 0) return "No change to the schedule";
  const count = `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"}`;
  return days > 0 ? `Adds ${count}` : `Takes ${count} off`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className={styles.sectionTitle}>{children}</h2>;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.figure}>
      <p className="text-muted-foreground font-label text-[10px] uppercase">
        {label}
      </p>
      <p className={styles.figureValue}>{value}</p>
    </div>
  );
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "The customer";
}
