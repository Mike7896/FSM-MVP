import { RecordTagSection } from "@/components/tags/record-tags";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, BriefcaseBusiness, Check, ChevronRight, Circle, Clock, Lock, MapPin, ShieldCheck } from "lucide-react";

import { DemoChip } from "@/components/demo-chip";
import { StagePill } from "@/components/jobs/stage-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization, requireSession } from "@/lib/dal";
import { JobTasks } from "@/components/tasks/job-tasks";
import { listTags } from "@/lib/queries/tags";
import { listTeam } from "@/lib/schedule";
import { DocumentRail } from "@/components/documents/document-rail";
import { CaptureRail } from "@/components/jobs/capture-rail";
import { ReceiptRail } from "@/components/jobs/receipt-rail";
import { listJobReceipts } from "@/lib/queries/receipts";
import { listCaptures } from "@/lib/queries/captures";
import { listJobDocuments } from "@/lib/queries/job-documents";
import { getJobHub, type StageRow } from "@/lib/queries/job-hub";
import { getOfficeIdentity } from "@/lib/queries/office";
import { formatMoney } from "@/lib/quote";
import { reconcileJobPayments } from "@/lib/stripe/collect";
import { cn } from "@/lib/utils";

import styles from "../jobs.module.css";

export const metadata: Metadata = { title: "Job" };

/** The job’s financial story, with its documents, field records, and next action. */
export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const org = await requireActiveOrganization();
  const { id } = await params;

  // A payment Stripe has taken but the webhook hasn't delivered is recorded
  // before the hub reads its money.
  await reconcileJobPayments(id, org.id).catch(() => false);

  const job = await getJobHub(id, org.id);
  if (!job) notFound();

  // The documents and the letterhead they carry. Fetched after the hub because
  // both need the job to exist first.
  const [documents, office, captures, receipts, team, tags, session] = await Promise.all([
    listJobDocuments(id, org.id),
    getOfficeIdentity(org.id),
    listCaptures(id, org.id),
    listJobReceipts(id, org.id),
    listTeam(org.id),
    listTags(org.id),
    requireSession(),
  ]);

  const first = job.customerName.trim().split(/\s+/)[0] || "the customer";
  // The deposit, from the job's plan once there is one — and from the quote
  // that asks for it until then.
  const depositStage = job.stages.find((stage) => stage.gate === "on_acceptance");
  const proposedDeposit = job.proposed?.payments.find((payment) => payment.gate === "on_acceptance");
  const deposit = depositStage
    ? {
        cents: depositStage.amountCents,
        detail:
          depositStage.state === "paid"
            ? "Paid"
            : depositStage.state === "sent"
              ? "Billed, waiting on payment"
              : "Due now",
      }
    : proposedDeposit
      ? { cents: proposedDeposit.amountCents, detail: `Due when ${first} accepts` }
      : null;

  const collectedPercent = job.money.totalCents > 0
    ? Math.max(0, Math.min(100, job.money.collectedCents / job.money.totalCents * 100))
    : 0;

  return (
    <div className={`@container ${styles.page}`}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
        <Link href="/jobs">Jobs</Link><ChevronRight size={13} /><span>Job #{job.number}</span>
      </nav>
      <section className={styles.overview} aria-label="Job overview">
        <header className={styles.jobHeader}>
          <div className="min-w-0">
            <p className={styles.eyebrow}>JOB #{job.number}</p>
            <h1 className={styles.jobTitle}>{job.name || job.customerName}</h1>
            <div className={styles.jobMeta}>
              <Link href={`/customers/${job.customerId}`} className={styles.customerLink}>{job.customerName}</Link>
              {job.address ? <span><MapPin size={13} />{job.address}</span> : null}
              {job.startsOn ? <span>Started {job.startsOn}</span> : null}
            </div>
          </div>
          <div className={styles.jobIdentity}>
            <span className={styles.jobIcon} aria-hidden="true"><BriefcaseBusiness size={25} strokeWidth={1.5} /></span>
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {job.demo ? <DemoChip /> : null}
                <StagePill label={job.stage.label} tone={job.stage.tone} size="md" />
              </div>
              {job.stage.detail ? (
                <p className="text-muted-foreground max-w-xs text-right text-xs">{job.stage.detail}</p>
              ) : null}
            </div>
          </div>
        </header>
        <div className={styles.moneyStrip} data-count={deposit ? 4 : 3}>
          <Figure label="Job value" cents={job.money.totalCents} />
          {deposit ? <Figure label="Deposit" cents={deposit.cents} detail={deposit.detail} /> : null}
          <Figure label="Collected" cents={job.money.collectedCents} />
          <Figure label="Still owed" cents={job.money.remainingCents} />
        </div>
        {job.money.totalCents > 0 ? (
          <div className={styles.collection}>
            <div><span>A clear path to paid</span><span>{Math.round(collectedPercent)}% collected</span></div>
            <div className={styles.progress} role="progressbar" aria-label="Job value collected" aria-valuenow={Math.round(collectedPercent)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${collectedPercent}%` }} />
            </div>
          </div>
        ) : null}
      </section>
      <RecordTagSection organizationId={org.id} entity="job" recordId={id} />

      {job.gate ? (
        <section className={styles.gate}>
          <p className="text-primary-ink flex items-center gap-2 font-label text-[11px] uppercase">
            <ShieldCheck size={15} /> Cleared to proceed
          </p>
          <p className="mt-2.5 text-sm">{job.gate.short}</p>
          <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
            {job.gate.detail}
          </p>
        </section>
      ) : null}

      <div className={styles.detailGrid}>
        <div className={styles.mainColumn}>
          {/* The phase timeline. Horizontal where there's room, so the shape of
              the job is one glance; stacked where there isn't. */}
          {job.stages.length > 0 ? (
            <section className={styles.panel}>
              <SectionLabel>The money, in order</SectionLabel>
              <ol className={styles.phases}>
                {job.stages.map((stage) => (
                  <Phase key={stage.id} name={stage.name} cents={stage.amountCents} state={stage.state} />
                ))}
              </ol>

              <div className="mt-3 @2xl:mt-4">
                {job.stages.map((stage) => (
                  <StageLine key={stage.id} jobId={job.id} stage={stage} />
                ))}
              </div>
            </section>
          ) : job.proposed ? (
            // **Proposed, not "nothing planned".** The quote already says how
            // it's paid — she agrees to it by accepting, and it becomes the
            // job's plan then. Changed on the quote, where she reads it.
            <section className={styles.panel}>
              <SectionLabel>The money, in order</SectionLabel>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Proposed on {job.proposed.quoteNumber} — it becomes the plan when{" "}
                {first} accepts.{" "}
                <Link
                  href={`/quotes/${job.proposed.quoteId}`}
                  className="text-foreground underline underline-offset-4"
                >
                  Change it in the quote
                </Link>
              </p>
              <ol className={styles.phases}>
                {job.proposed.payments.map((payment, index) => (
                  <Phase
                    key={payment.phaseKey ?? `${payment.name}-${index}`}
                    name={payment.name}
                    cents={payment.amountCents}
                    state="gated"
                  />
                ))}
              </ol>
              <div className="mt-3 @2xl:mt-4">
                {job.proposed.payments.map((payment, index) => (
                  <div key={payment.phaseKey ?? `${payment.name}-${index}`} className={styles.stageLine}>
                    <span className={styles.stageIcon} data-state="gated">
                      <Circle size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{payment.name}</p>
                      <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                        {payment.gate === "on_acceptance"
                          ? `Due when ${first} accepts`
                          : payment.gate === "on_completion"
                            ? "Bill this when the job's done"
                            : "Bill this when the phase is done"}
                      </p>
                    </div>
                    <span className="text-muted-foreground shrink-0 font-medium tabular-nums">
                      {formatMoney(payment.amountCents)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section className={styles.panel}>
              <SectionLabel>The money, in order</SectionLabel>
              <p className="text-muted-foreground border-t py-4 text-sm">
                Nothing planned yet — a deposit, draws as phases finish, or one
                invoice at the end.{" "}
                <Link
                  href={`/jobs/${job.id}/money#phases`}
                  className="text-foreground underline underline-offset-4"
                >
                  Plan the phases
                </Link>
              </p>
            </section>
          )}

          {/* **The paperwork, drawn as paperwork, in the order it happened.**
              Four quiet rows saying "the quote · the contract · change orders"
              was a directory; the same documents laid out in time is the story
              of the job, readable in one pass. */}
          <section className={styles.panel}>
            <SectionLabel>The paperwork, in order</SectionLabel>
            {job.documents.contractId && <Link href={`/jobs/${id}/change-orders`} className="mt-3 inline-block text-sm underline underline-offset-4">Change orders and customer requests</Link>}
            {documents.length === 0 ? (
              // Both doors open onto this job, so a job made first — from New
              // job — is never a dead end.
              <p className="text-muted-foreground border-t py-4 text-sm">
                Nothing sent on this job yet.{" "}
                <Link
                  href={`/quotes/new?job=${job.id}&customer=${job.customerId}`}
                  className="text-foreground underline underline-offset-4"
                >
                  Start the quote
                </Link>{" "}
                — that&apos;s where it usually begins. Or{" "}
                <Link
                  href={`/jobs/${job.id}/invoices/new`}
                  className="text-foreground underline underline-offset-4"
                >
                  bill it with no quote
                </Link>
                ; that&apos;s a real thing too.
              </p>
            ) : (
              <div className="pt-3">
                <DocumentRail
                  documents={documents}
                  businessName={office.businessName}
                  license={office.license}
                  customerName={job.customerName}
                />
              </div>
            )}
          </section>

          {/* The walkthrough stays visible alongside the job's paperwork. */}
          <section className={styles.panel}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <SectionLabel>From the visit</SectionLabel>
              <Link
                href={`/jobs/${job.id}/capture`}
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
              >
                Add captures
              </Link>
            </div>
            {captures.length > 0 ? (
              <CaptureRail captures={captures} />
            ) : (
              <p className="text-muted-foreground mt-3 border-t py-4 text-sm">
                Nothing captured yet. Photos, notes and measurements from the visit will appear here.
              </p>
            )}
          </section>

          <section id="receipts" className={`${styles.panel} scroll-mt-20`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <SectionLabel>What you&apos;ve spent</SectionLabel>
              <Link href={`/jobs/${job.id}/receipt`} className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4">Add a receipt</Link>
            </div>
            {receipts.length > 0 ? (
              <>
                <p className="text-muted-foreground mt-1 text-xs">{receipts.length} {receipts.length === 1 ? "receipt" : "receipts"} · {formatMoney(receipts.reduce((total, receipt) => total + receipt.amountCents, 0))} spent</p>
                <ReceiptRail receipts={receipts} demo={job.demo} />
              </>
            ) : (
              <p className="text-muted-foreground mt-3 border-t py-4 text-sm">No receipts yet. Record materials and other job expenses here.</p>
            )}
          </section>
        </div>

        <aside className={styles.sideColumn}>
          {/* What's still to do here — the job is the project, and these are
              its tasks. First in the column: it changes daily, where permits
              change monthly. */}
          <JobTasks
            className={styles.panel}
            heading={<SectionLabel>Tasks</SectionLabel>}
            job={{
              id: job.id,
              number: job.number,
              name: job.name,
              customerName: job.customerName,
              address: job.address,
            }}
            team={team}
            me={session.userId}
            organizationId={org.id}
            tags={tags}
          />

          {/* Permits sit on the hub, not in a side trip: permit status gates in
              both directions — issued often clears the start of work alongside
              the deposit, closed often clears the final invoice. */}
          <section className={styles.panel}>
            <SectionLabel>Permits</SectionLabel>
            {job.permits.length === 0 ? (
              <p className="text-muted-foreground border-t py-4 text-sm">
                {job.jurisdiction
                  ? `No permit on file for ${job.jurisdiction}.`
                  : "No permit on this job."}
              </p>
            ) : (
              job.permits.map((permit) => (
                <div key={permit.id} className="border-t py-4">
                  <Link
                    href={`/jobs/${job.id}/permits/${permit.id}`}
                    className="flex items-baseline justify-between gap-3 hover:underline"
                  >
                    <span className="text-sm font-medium">
                      {permit.jurisdiction}
                    </span>
                    <Badge variant="outline" className="capitalize">
                      {permit.status.replace(/_/g, " ")}
                    </Badge>
                  </Link>
                  {permit.number ? (
                    <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed tabular-nums">
                      #{permit.number}
                    </p>
                  ) : null}
                  {permit.inspections.length > 0 ? (
                    <ul className="mt-2.5 flex flex-col gap-1.5">
                      {permit.inspections.map((inspection) => (
                        <li
                          key={inspection.id}
                          className="text-muted-foreground flex items-baseline justify-between gap-3 text-xs"
                        >
                          <span className="capitalize">
                            {inspection.type.replace(/_/g, " ")}
                          </span>
                          <span className="capitalize">
                            {inspection.result === "scheduled" &&
                            inspection.scheduledOn
                              ? inspection.scheduledOn
                              : inspection.result}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))
            )}
          </section>

          {job.money.spentCents > 0 ? (
            <section className={styles.panel}>
              <SectionLabel>Spent so far</SectionLabel>
              <p className={styles.figureValue}>
                {formatMoney(job.money.spentCents)}
              </p>
              <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                Materials and anything else logged against this job. Never on
                her copy.
              </p>
            </section>
          ) : null}
        </aside>
      </div>

      {/* The one primary action, whatever the job needs next. Sticky at the
          foot so it is reachable without scrolling back. */}
      {job.nextAction ? (
        <div className={styles.actionBar}>
          <div className={styles.actionHint}><span className={styles.eyebrow}>UP NEXT</span><span>{job.nextAction.label}</span></div>
          <Button asChild size="lg" className="w-full @xl:w-auto">
            <Link href={job.nextAction.href}>{job.nextAction.label}<ArrowRight size={16} /></Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className={styles.sectionTitle}>
      {children}
    </h2>
  );
}

function Figure({
  label,
  cents,
  detail,
}: {
  label: string;
  cents: number;
  detail?: string;
}) {
  return (
    <div className={styles.figure}>
      <p className="text-muted-foreground font-label text-[10px] uppercase">
        {label}
      </p>
      <p className={styles.figureValue}>
        {formatMoney(cents)}
      </p>
      {detail ? (
        <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">{detail}</p>
      ) : null}
    </div>
  );
}

const STATE_ICON = {
  paid: Check,
  sent: Clock,
  ready: Circle,
  gated: Lock,
} as const;

/** One stage in the horizontal timeline — the shape of the job at a glance. */
function Phase({
  name,
  cents,
  state,
}: {
  name: string;
  cents: number;
  state: StageRow["state"];
}) {
  const Icon = STATE_ICON[state];
  return (
    <li
      className={cn(
        styles.phase,
        state === "ready" && "border-primary/60 bg-primary/[0.03]",
        state === "gated" && "text-muted-foreground"
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="size-3 shrink-0" />
        <span className="truncate font-label text-[10px] uppercase">
          {name}
        </span>
      </div>
      <p className="mt-1.5 font-medium tabular-nums">
        {formatMoney(cents)}
      </p>
    </li>
  );
}

/**
 * A ledger line: what the stage is, what it's worth, and where it stands.
 *
 * The state comes from the invoice and its payments, never from a column
 * somebody had to remember to update — the same reason the job's money is
 * derived rather than stored.
 */
function StageLine({ jobId, stage }: { jobId: string; stage: StageRow }) {
  // A billed stage opens its bill. The deposit is billed straight away; any
  // other phase is marked complete first, with the proof, and billed there.
  const href = stage.invoiceId
    ? `/invoices/${stage.invoiceId}`
    : stage.gate === "on_acceptance"
      ? `/jobs/${jobId}/invoices/new?stage=${stage.id}`
      : `/jobs/${jobId}/complete?phase=${stage.id}`;

  const Icon = STATE_ICON[stage.state];
  const body = (
    <>
      <span className={styles.stageIcon} data-state={stage.state}><Icon size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{stage.name}</p>
        <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">{stage.detail}</p>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            "font-medium tabular-nums",
            stage.state === "gated" && "text-muted-foreground"
          )}
        >
          {formatMoney(stage.amountCents)}
        </span>
        <ChevronRight className="text-muted-foreground size-4" />
      </span>
    </>
  );

  return (
    <Link
      href={href}
      className={styles.stageLine}
    >
      {body}
    </Link>
  );
}

