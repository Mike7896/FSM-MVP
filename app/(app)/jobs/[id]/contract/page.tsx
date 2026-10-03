import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ChevronRight,
  FilePlus2,
  FileSignature,
  FileText,
  MapPin,
  PenLine,
} from "lucide-react";

import { DemoChip } from "@/components/demo-chip";
import { DocumentCard } from "@/components/documents/document-card";
import { inkFor } from "@/components/documents/ink";
import { ContractModeSwitch } from "@/components/documents/mode-switch";
import { SendContractButton } from "@/components/documents/send-contract-button";
import { LocalTime } from "@/components/local-time";
import {
  IntegrityNote,
  SignatureLine,
  Timeline,
} from "@/components/documents/standing";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { requireActiveOrganization } from "@/lib/dal";
import { emailConfigured } from "@/lib/email/send";
import {
  getContractStanding,
  getJobContract,
  type ContractStanding,
  type ContractView,
} from "@/lib/queries/contracts";
import { listJobDocuments } from "@/lib/queries/job-documents";
import { getJobHub } from "@/lib/queries/job-hub";
import { jobTimeline, type JobEvent } from "@/lib/queries/job-timeline";
import { formatChange, formatMoney } from "@/lib/quote";
import {
  certificateFor,
  type SignatureRecord,
} from "@/lib/signing/certificate";
import { cn } from "@/lib/utils";

import styles from "../../jobs.module.css";

export const metadata: Metadata = { title: "Contract" };

/**
 * The Contract · class A·B·C — where it stands, and what to do with it.
 *
 * Generated the moment a Quote is accepted, with the contractor's signature
 * applied; the homeowner reads and signs it, and signing is what triggers the
 * deposit ask. That makes **approved but unsigned** a real state rather than a
 * gap, and this page has to render it as one.
 *
 * **Two pages, like the quote's two modes.** This one is an ordinary screen —
 * the signatures and the evidence behind them, what has happened since it was
 * drawn up, the deposit, the changes — and the Document page is the sheet of
 * paper itself. Nobody edits a Contract, so where a quote has Edit, a contract
 * has this: its life after it was written.
 *
 * It is not a second job page. The job holds the money and the rest of the
 * paperwork; this holds the agreement, and links back for everything else.
 */
export default async function ContractPage({
  params,
}: PageProps<"/jobs/[id]/contract">) {
  const org = await requireActiveOrganization();
  const { id } = await params;

  const contract = await getJobContract(id, org.id);

  if (!contract) {
    // No contract yet is the ordinary state for a job still being quoted, so it
    // gets described rather than treated as an error.
    const job = await getJobHub(id, org.id);
    if (!job) notFound();

    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <PageHeader
          title="Contract"
          description={[job.customerName, job.name].filter(Boolean).join(" — ")}
        />
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing agreed yet</EmptyTitle>
            <EmptyDescription>
              A contract is generated the moment a quote is accepted — it is not
              something you write. It carries the full agreed scope and your
              signature, and hers is what starts the deposit.
            </EmptyDescription>
          </EmptyHeader>
          {job.documents.quoteId ? (
            <EmptyContent>
              <Button asChild variant="outline">
                <Link href={`/quotes/${job.documents.quoteId}`}>
                  Open the quote
                </Link>
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      </div>
    );
  }

  const [standing, certificate, documents, events] = await Promise.all([
    getContractStanding(contract.id, org.id),
    certificateFor(contract.id, org.id),
    listJobDocuments(id, org.id),
    jobTimeline(id, org.id),
  ]);
  if (!standing || !certificate) notFound();

  const sheet = documents.find(
    (document) => document.kind === "contract" && document.id === contract.id
  );
  const signed = contract.customerSignedAt !== null;
  // The business signs first. The customer's link can't take a signature
  // until it has, so an unsigned business line is what's holding the job up.
  const awaitingYou = contract.contractorSignedAt === null;
  const first = firstName(contract.customerName);
  const title = sheet?.title ?? contract.jobName ?? "Contract";
  const number = sheet?.number ?? null;

  const viewHref = `/jobs/${id}/contract/view`;
  const status = signed
    ? "Signed"
    : awaitingYou
      ? "Waiting on you"
      : `Waiting on ${first}`;

  return (
    <div className={`@container ${styles.page}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href="/jobs">Jobs</Link>
          <ChevronRight size={13} />
          <Link href={`/jobs/${id}`}>Job #{contract.jobNumber}</Link>
          <ChevronRight size={13} />
          <span>Contract</span>
        </nav>
        <ContractModeSwitch mode="overview" jobId={id} />
      </div>

      <section className={styles.overview} aria-label="Contract overview">
        <header className={styles.jobHeader}>
          <div className="min-w-0">
            <p className={cn(styles.eyebrow, "flex items-center gap-2")}>
              <span
                className={cn("size-1.5 rounded-full", inkFor("Contract").dot)}
              />
              CONTRACT{number ? ` · ${number}` : ""}
            </p>
            <h1 className={styles.jobTitle}>{title}</h1>
            <div className={styles.jobMeta}>
              <Link
                href={`/customers/${contract.customerId}`}
                className={styles.customerLink}
              >
                {contract.customerName}
              </Link>
              {contract.address ? (
                <span>
                  <MapPin size={13} />
                  {contract.address}
                </span>
              ) : null}
              {standing.acceptedAt ? (
                <span>
                  Agreed{" "}
                  <LocalTime
                    iso={standing.acceptedAt.toISOString()}
                    format="date"
                  />
                </span>
              ) : null}
              {contract.sourceQuoteId && contract.sourceQuoteNumber ? (
                <Link
                  href={`/quotes/${contract.sourceQuoteId}/view`}
                  className="hover:text-foreground underline underline-offset-4"
                >
                  From quote {contract.sourceQuoteNumber}
                </Link>
              ) : null}
            </div>
          </div>
          <div className={styles.jobIdentity}>
            <span className={styles.jobIcon} aria-hidden="true">
              <FileSignature size={25} strokeWidth={1.5} />
            </span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {contract.demo ? <DemoChip /> : null}
              <Badge variant="secondary" className={styles.status}>
                {status}
              </Badge>
            </div>
          </div>
        </header>

        <div className={styles.moneyStrip}>
          <Figure label="Signed at" value={formatMoney(contract.agreedPriceCents)} />
          <Figure
            label="Changes"
            value={formatChange(
              contract.currentPriceCents - contract.agreedPriceCents
            )}
          />
          <Figure
            label="Contract now"
            value={formatMoney(contract.currentPriceCents)}
          />
        </div>

        {/* What there is to do, in the order it matters: your signature first,
            because nothing moves until it's on. */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {awaitingYou ? (
            <Button asChild>
              <Link href={`${viewHref}#sign`}>
                <PenLine />
                Sign it
              </Link>
            </Button>
          ) : null}
          <Button asChild variant={awaitingYou ? "outline" : "default"}>
            <Link href={viewHref}>
              <FileText />
              View the contract
            </Link>
          </Button>
          {/* A practice contract stays with the shop, so it has nowhere to go. */}
          {contract.demo ? null : (
            <SendContractButton
              contractId={contract.id}
              customerName={contract.customerName}
              customerEmail={contract.customerEmail}
              emailEnabled={emailConfigured()}
              signed={signed}
            />
          )}
          {signed ? (
            <Button asChild variant="outline">
              <Link href={`/jobs/${id}/change-orders/new`}>
                <FilePlus2 />
                Write a change order
              </Link>
            </Button>
          ) : null}
        </div>
      </section>

      <div className={styles.detailGrid}>
        <div className={styles.mainColumn}>
          <Signatures
            contract={contract}
            signatures={certificate.signatures}
            first={first}
            signHref={`${viewHref}#sign`}
            recordHref={`/jobs/${id}/contract/certificate`}
          />

          <History events={events} />

          <Changes
            jobId={id}
            contract={contract}
            signed={signed}
          />
        </div>

        <aside className={styles.sideColumn}>
          {sheet ? (
            <section className={styles.panel}>
              <SectionLabel>The document</SectionLabel>
              <div className="mx-auto max-w-[200px]">
                <DocumentCard
                  href={viewHref}
                  businessName={contract.businessName}
                  license={contract.licenseNumber}
                  customerName={contract.customerName}
                  title={sheet.title}
                  number={sheet.number}
                  documentType="Contract"
                  rows={sheet.rows}
                  totalCents={sheet.totalCents}
                  status={status}
                  caption={sheet.title}
                  demo={contract.demo}
                />
              </div>
              <p className="text-muted-foreground mt-3 text-center text-xs">
                The page you both signed. Open it to read, print or save a PDF.
              </p>
            </section>
          ) : null}

          <Deposit standing={standing} signed={signed} first={first} />
        </aside>
      </div>
    </div>
  );
}

/* ── Signatures ─────────────────────────────────────────────────────────── */

/**
 * Who has signed, and the evidence behind each one — how, when, whether they
 * agreed to sign electronically. **Whose move it is** is the one question the
 * section has to answer at a glance, so an unsigned line says whose it is and
 * what unblocks it rather than a generic "awaiting signatures".
 */
function Signatures({
  contract,
  signatures,
  first,
  signHref,
  recordHref,
}: {
  contract: ContractView;
  signatures: SignatureRecord[];
  first: string;
  signHref: string;
  recordHref: string;
}) {
  const contractor = signatures.find((entry) => entry.party === "contractor");
  const customer = signatures.find((entry) => entry.party === "customer");
  const count = [contractor, customer].filter(Boolean).length;

  return (
    <section className={styles.panel}>
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel>Signatures</SectionLabel>
        <span className="text-muted-foreground text-xs">{count} of 2</span>
      </div>

      <SignatureLine
        label={`For ${contract.businessName ?? "your business"}`}
        signature={contractor}
        pending={
          <>
            Not signed yet — {first} can&apos;t sign until you have.{" "}
            <Link
              href={signHref}
              className="text-foreground underline underline-offset-4"
            >
              Sign it
            </Link>
          </>
        }
      />
      <SignatureLine
        label="Customer"
        signature={customer}
        pending={
          contractor
            ? `Waiting on ${first}. Their link is ready to sign.`
            : `Opens for ${first} once you've signed.`
        }
      />

      <IntegrityNote signatures={signatures} recordHref={recordHref} />
    </section>
  );
}

/* ── What's happened ───────────────────────────────────────────────────── */

/**
 * The whole job's story, oldest first — quote, contract, change orders, bills
 * and payments — then what's still to come, quiet, so the shape of what's
 * left is visible before it has happened.
 */
function History({ events }: { events: JobEvent[] }) {
  return (
    <section className={styles.panel}>
      <SectionLabel>What&apos;s happened</SectionLabel>
      <Timeline steps={events} />
    </section>
  );
}

/* ── Changes since signing ─────────────────────────────────────────────── */

/**
 * The change orders that amend it — listed here rather than written into it.
 * The original stays exactly as signed, which is the whole point of never
 * editing one.
 */
function Changes({
  jobId,
  contract,
  signed,
}: {
  jobId: string;
  contract: ContractView;
  signed: boolean;
}) {
  const orders = contract.changeOrders;

  return (
    <section className={styles.panel}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>Changes since it was signed</SectionLabel>
        <Link
          href={`/jobs/${jobId}/change-orders`}
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
        >
          Change orders and customer requests
        </Link>
      </div>

      {orders.length === 0 ? (
        <p className="text-muted-foreground border-t py-4 text-sm">
          None. When the work or the price changes, it goes through a change
          order — the contract itself is never edited.
          {signed ? (
            <>
              {" "}
              <Link
                href={`/jobs/${jobId}/change-orders/new`}
                className="text-foreground underline underline-offset-4"
              >
                Write one
              </Link>
            </>
          ) : null}
        </p>
      ) : (
        <ol>
          {orders.map((order) => (
            <li key={order.id} className="border-t">
              <Link
                href={`/jobs/${jobId}/change-orders/${order.id}`}
                className="hover:bg-muted/50 -mx-1 flex items-baseline justify-between gap-4 rounded-md px-1 py-3 transition-colors"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        inkFor("Change order").dot
                      )}
                    />
                    {order.number} · {order.whatChanged ?? "No description"}
                  </span>
                  <span className="text-muted-foreground block pl-3.5 text-xs capitalize">
                    {order.status.replace(/_/g, " ")}
                    {order.timeImpactDays
                      ? ` · ${order.timeImpactDays > 0 ? "+" : "−"}${Math.abs(order.timeImpactDays)} ${Math.abs(order.timeImpactDays) === 1 ? "day" : "days"}`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {formatChange(order.priceDeltaCents)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ── Deposit ───────────────────────────────────────────────────────────── */

/**
 * The money the contract asks for up front, read from the invoice that asks
 * for it and the payments against it — never from a status somebody set.
 */
function Deposit({
  standing,
  signed,
  first,
}: {
  standing: ContractStanding;
  signed: boolean;
  first: string;
}) {
  const askedCents = standing.depositCents ?? 0;
  const invoice = standing.deposit;

  return (
    <section className={styles.panel}>
      <SectionLabel>Deposit</SectionLabel>
      {askedCents <= 0 ? (
        <p className="text-muted-foreground border-t pt-4 text-sm">
          No deposit on this contract.
        </p>
      ) : (
        <div className="border-t pt-4">
          <p className="text-2xl font-semibold tabular-nums">
            {formatMoney(invoice?.amountDueCents ?? askedCents)}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {!invoice
              ? signed
                ? "Not asked for yet."
                : `Asked for once ${first} signs.`
              : invoice.paidCents >= invoice.amountDueCents
                ? "Paid in full."
                : invoice.paidCents > 0
                  ? `${formatMoney(invoice.amountDueCents - invoice.paidCents)} still owed.`
                  : `Asked for — not paid yet.`}
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
      )}
    </section>
  );
}

/* ── Small pieces ──────────────────────────────────────────────────────── */

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
