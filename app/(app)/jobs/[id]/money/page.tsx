import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { JobBreakdown } from "@/components/jobs/job-breakdown";
import { PhasePlanner } from "@/components/jobs/phase-planner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { requireActiveOrganization } from "@/lib/dal";
import { getJobAgreement } from "@/lib/queries/job-agreement";
import { getJobHub } from "@/lib/queries/job-hub";
import { materialsBudget } from "@/lib/queries/jobs";
import { PAYMENT_WHEN, formatMoney, isText } from "@/lib/quote";
import { db } from "@/lib/db";
import { receipts } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { attachmentUrl } from "@/lib/field/storage";

export const metadata: Metadata = { title: "Job money" };

/**
 * The job money view · Flow 7, job F1.
 *
 * The rule this screen exists to hold: **the alert must always pair the problem
 * with the action that fixes it.** A negative materials balance on its own is
 * an anxiety; "the rough-in draw covers this — bill it" is a way out.
 *
 * The materials budget is the **material lines on the priced document**, not a
 * fraction of the job total. A convention like "35% of the contract" would fire
 * an overspend warning on a labour-heavy service call and stay silent on a
 * materials-heavy rewire — an alert on the wrong jobs is worse than no alert.
 */
export default async function JobMoneyPage({
  params,
}: PageProps<"/jobs/[id]/money">) {
  const org = await requireActiveOrganization();
  const { id } = await params;

  const [job, agreement] = await Promise.all([
    getJobHub(id, org.id),
    getJobAgreement(id, org.id),
  ]);
  if (!job) notFound();
  const first = job.customerName.trim().split(/\s+/)[0] || "the customer";

  // Which parts of the job each agreed phase covers, by the phase's key.
  const covers = new Map(
    (agreement?.plan ?? [])
      .filter((payment) => payment.phaseKey && payment.rows.length)
      .map((payment) => [
        payment.phaseKey!,
        payment.rows
          .filter((node) => !isText(node) && !node.optional)
          .map((node) => node.description.trim() || "Untitled row")
          .join(", "),
      ])
  );

  const receiptRows = await db.select().from(receipts).where(eq(receipts.jobId, id)).orderBy(desc(receipts.capturedAt));
  const receiptViews = await Promise.all(receiptRows.map(async row => ({
    ...row, url: row.imageUrl ? await attachmentUrl(row.imageUrl, `${org.id}/${id}/receipts`) : null,
  })));

  const budget = await materialsBudget(id);
  const overspend =
    budget !== null && budget > 0 ? job.money.spentCents - budget : 0;
  const unbilled = Math.max(job.money.totalCents - job.money.billedCents, 0);

  // The stage that would cover an overspend — the action half of the alert.
  const billable = job.stages.find((stage) => stage.state === "ready");

  return (
    // **The breakdown beside the plan.** Splitting a job into phases means
    // knowing what each part of it costs, so at the desk the parts sit in a
    // column beside the phases; on a phone they follow them.
    <div className="@container mx-auto w-full max-w-6xl">
    <div className="grid items-start gap-8 @4xl:grid-cols-[minmax(0,1fr)_22rem]">
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        title="Job money"
        description={[job.customerName, job.name].filter(Boolean).join(" — ")}
      />

      {overspend > 0 ? (
        <div className="border-destructive/50 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-l-4 p-5">
          <div className="min-w-0">
            <p className="text-destructive font-label text-[11px] uppercase">
              Over on materials
            </p>
            <p className="mt-1 text-sm">
              You&apos;re {formatMoney(overspend)} past what the materials were
              priced at.
              {billable
                ? ` The ${billable.name.toLowerCase()} draw covers it.`
                : " Nothing is billable yet to cover it."}
            </p>
          </div>
          {/* The alert never appears without the way out. */}
          {billable ? (
            <Button asChild size="sm" className="shrink-0">
              <Link href={`/jobs/${job.id}/invoices/new?stage=${billable.id}`}>
                Bill the draw
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-5 rounded-lg border p-5">
        <Bar
          label={job.documents.contractId ? "Agreed total" : "Quoted total"}
          cents={job.money.totalCents}
          of={job.money.totalCents}
        />
        <Bar
          label="Billed"
          cents={job.money.billedCents}
          of={job.money.totalCents}
        />
        <Bar
          label="Collected"
          cents={job.money.collectedCents}
          of={job.money.totalCents}
        />
        <Bar
          label="Spent on materials"
          cents={job.money.spentCents}
          of={budget}
          note={
            budget === null
              ? "Nothing priced yet, so there's no budget to compare against."
              : `of ${formatMoney(budget)} priced`
          }
        />
      </div>

      {unbilled > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {formatMoney(unbilled)} of this job is not billed yet
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Bill it against the contract, with evidence attached.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href={`/jobs/${job.id}/invoices/new`}>Bill a milestone</Link>
          </Button>
        </div>
      ) : null}

      {job.stages.length === 0 && job.proposed ? (
        // The quote says how it's paid, and she reads it there — so it's
        // changed there, and the job takes it on when she accepts.
        <section id="phases" className="flex scroll-mt-20 flex-col gap-4 rounded-xl border p-5">
          <div>
            <h2 className="font-label text-[11px] uppercase">How this job gets paid</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Proposed on {job.proposed.quoteNumber}. {first} sees the deposit and
              every phase before accepting, so they&apos;re set on the quote, and
              become this job&apos;s plan when {first} accepts.
            </p>
          </div>
          <ul className="flex flex-col">
            {job.proposed.payments.map((payment, index) => (
              <li
                key={payment.phaseKey ?? `${payment.name}-${index}`}
                className="flex items-baseline justify-between gap-3 border-t py-2.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium">{payment.name}</span>
                  {payment.phaseKey && covers.get(payment.phaseKey) ? (
                    <span className="text-muted-foreground block text-xs">
                      Covers {covers.get(payment.phaseKey)}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground block text-xs">
                    {payment.gate === "on_acceptance"
                      ? `When ${first} accepts`
                      : PAYMENT_WHEN[payment.gate]}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{formatMoney(payment.amountCents)}</span>
              </li>
            ))}
          </ul>
          <div className="border-t pt-4">
            <Button asChild size="sm" variant="outline">
              <Link href={`/quotes/${job.proposed.quoteId}`}>Change it in the quote</Link>
            </Button>
          </div>
        </section>
      ) : (
        <PhasePlanner
          jobId={job.id}
          // Only a contract is an agreement; a quote's total is still a proposal.
          agreedCents={job.documents.contractId ? job.money.totalCents : 0}
          phases={job.stages.map((stage) => ({
            id: stage.id,
            name: stage.name,
            amountCents: stage.amountCents,
            gate: stage.gate,
            billed: stage.invoiceId !== null,
            covers: stage.phaseKey ? (covers.get(stage.phaseKey) ?? null) : null,
          }))}
        />
      )}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Receipts</h2>
          <Button asChild variant="outline"><Link href={`/jobs/${id}/receipt`}>Add a receipt</Link></Button>
        </div>
        {receiptViews.length === 0 && <p className="text-muted-foreground text-sm">No receipts recorded yet.</p>}
        {receiptViews.map(row => <div key={row.id} className="flex justify-between gap-4 border-t py-3 text-sm">
          <div><p>{row.vendor || "Receipt"} · {row.purchasedOn}</p><p className="text-muted-foreground">{row.description}</p>
            {row.url ? <a href={row.url} target="_blank" rel="noopener noreferrer" className="underline">View attachment</a> : row.imageUrl ? <p>Attachment unavailable. Refresh to try again.</p> : null}
          </div><span>{formatMoney(row.amountCents)}</span>
        </div>)}
      </section>
    </div>

    {agreement ? (
      <aside className="@4xl:sticky @4xl:top-20">
        <JobBreakdown agreement={agreement} />
      </aside>
    ) : null}
    </div>
    </div>
  );
}

function Bar({
  label,
  cents,
  of,
  note,
}: {
  label: string;
  cents: number;
  of: number | null;
  note?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{formatMoney(cents)}</span>
      </div>
      <Progress
        value={of && of > 0 ? Math.min(100, (cents / of) * 100) : 0}
      />
      {note ? (
        <p className="text-muted-foreground mt-1 text-xs">{note}</p>
      ) : null}
    </div>
  );
}
