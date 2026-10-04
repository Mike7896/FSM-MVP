import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  documents,
  drawSchedule,
  evidence,
  inspections,
  invoiceDetails,
  jobs,
  permits,
} from "@/lib/db/schema";
import { jobStage, type JobStage } from "@/lib/billing/stage";
import type { DocumentStatus } from "@/lib/documents";
import { collectedForInvoice } from "@/lib/ledger";
import { openGates, type Gate } from "@/lib/queries/gates";
import { listInvoices } from "@/lib/queries/invoices";
import { getJobAgreement } from "@/lib/queries/job-agreement";
import { jobMoney, type JobMoney } from "@/lib/queries/jobs";
import type { PlannedPayment } from "@/lib/quote";
import { passedInspectionPhases } from "@/lib/field/inspection-gates";

/**
 * The Job hub — **the story of this job's money**, not a database dump.
 *
 * Three rules from the drawings govern what this returns, and each one is a
 * decision about the model rather than the screen:
 *
 * **There is no work order.** The Contract carries the full agreed scope, and
 * "what am I building right now, after three change orders" is a *view* on the
 * Job rather than a fourth document somebody has to keep in step.
 *
 * **Invoices source from the Contract, never the Quote.** That is what
 * guarantees an approved change order can never be dropped from a bill.
 *
 * **Permits sit on the hub.** Permit status gates in both directions: `issued`
 * frequently clears the start of work alongside the deposit, and `closed`
 * frequently clears the final invoice.
 *
 * Everything is derived at read time. Nothing about the hub is stored, so
 * nothing can go stale.
 */

export type StageRow = {
  id: string;
  /** What the contractor calls this stage. */
  name: string;
  amountCents: number;
  gate: (typeof drawSchedule.gate.enumValues)[number];
  position: number;
  /** The quote phase it was planned from — how the job knows which rooms it covers. */
  phaseKey: string | null;
  /** Null until the stage is billed. */
  invoiceId: string | null;
  invoiceStatus: DocumentStatus | null;
  paidCents: number;
  /** Where this stage stands, in the words the hub uses. */
  state: "paid" | "sent" | "ready" | "gated";
  /** Why it is still gated, when it is. */
  detail: string;
  /** Evidence recorded for this stage but not yet billed. */
  evidenceReady: boolean;
};

export type JobHub = {
  id: string;
  number: number;
  name: string | null;
  address: string | null;
  jurisdiction: string | null;
  status: (typeof jobs.status.enumValues)[number];
  /** Where it stands in words — the status, read with its invoices and money. */
  stage: JobStage;
  startsOn: string | null;
  customerId: string;
  customerName: string;
  /** A demo job: shown and labelled, and left out of every count. */
  demo: boolean;

  money: JobMoney;
  /** The open gate, if one is. The hub's only framed block. */
  gate: Gate | null;
  stages: StageRow[];
  /**
   * Nothing planned on the job yet, but its quote proposes how it's paid: the
   * deposit and phases she'll agree to by accepting. It becomes `stages` at
   * acceptance, so until then it is shown as proposed rather than as
   * "nothing planned".
   */
  proposed: ProposedPlan | null;

  permits: {
    id: string;
    jurisdiction: string;
    number: string | null;
    status: (typeof permits.status.enumValues)[number];
    issuedOn: string | null;
    inspections: {
      id: string;
      type: (typeof inspections.type.enumValues)[number];
      result: (typeof inspections.result.enumValues)[number];
      scheduledOn: string | null;
      completedOn: string | null;
    }[];
  }[];

  /** The quiet rows at the foot of the hub. */
  documents: {
    quoteId: string | null;
    /** `Q-0007`. */
    quoteNumber: string | null;
    contractId: string | null;
    changeOrderCount: number;
    receiptCount: number;
    receiptTotalCents: number;
  };

  /**
   * **One primary action at a time**, and it changes as the job moves:
   * collect · bill the phase · send the invoice · nothing. Derived here rather
   * than in the page so the native app offers the same next step.
   */
  nextAction: { label: string; href: string } | null;
};

export type ProposedPlan = {
  quoteId: string;
  /** `Q-0003`. */
  quoteNumber: string;
  quoteStatus: string;
  payments: Pick<PlannedPayment, "name" | "gate" | "amountCents" | "phaseKey">[];
};

export async function getJobHub(
  jobId: string,
  organizationId: string
): Promise<JobHub | null> {
  const [job] = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      name: jobs.name,
      address: jobs.address,
      jurisdiction: jobs.jurisdiction,
      status: jobs.status,
      startsOn: jobs.startsOn,
      customerId: customers.id,
      customerName: customers.name,
      demo: jobs.isDemo,
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);

  if (!job) return null;

  const [money, gates, stages, permitRows, documentRows, invoices] = await Promise.all([
    jobMoney([jobId]),
    openGates(organizationId),
    buildStages(jobId),
    buildPermits(jobId),
    buildDocuments(jobId),
    listInvoices(organizationId, { jobId, limit: 100 }),
  ]);

  const state = money.get(jobId) ?? {
    jobId,
    totalCents: 0,
    billedCents: 0,
    collectedCents: 0,
    spentCents: 0,
    remainingCents: 0,
  };

  // A plan the quote proposes, read only when the job has none of its own.
  const agreement = stages.length === 0 ? await getJobAgreement(jobId, organizationId) : null;
  const proposed: ProposedPlan | null =
    agreement?.kind === "quote" && agreement.quoteId
      ? {
          quoteId: agreement.quoteId,
          quoteNumber: agreement.number,
          quoteStatus: agreement.status,
          payments: agreement.plan.map(({ name, gate, amountCents, phaseKey }) => ({
            name,
            gate,
            amountCents,
            phaseKey,
          })),
        }
      : null;

  // Every phase in the plan past its gate: the work is done, whatever is
  // or isn't billed yet. A deposit is paid up front, so it says nothing.
  const work = stages.filter((row) => row.gate !== "on_acceptance");
  const workDone = work.length > 0 && work.every((row) => row.state !== "gated");

  return {
    ...job,
    stage: jobStage({
      status: job.status,
      agreedCents: state.totalCents,
      collectedCents: state.collectedCents,
      invoices,
      workDone,
    }),
    money: state,
    gate: gates.get(jobId) ?? null,
    stages,
    proposed,
    permits: permitRows,
    documents: documentRows,
    nextAction: nextAction(jobId, stages, job.status, proposed),
  };
}

/* ── The money, in order ──────────────────────────────────────────────── */

/**
 * The draw schedule, with what has actually happened to each stage.
 *
 * **These are stages, not ledger entries.** They are a plan for money that has
 * mostly *not* moved yet, and they read the ledger for the one fact they need:
 * how much has landed against the invoice a stage became.
 *
 * A stage's amount comes from the schedule, but its *state* comes from the
 * invoice and the payments — never from a column somebody has to remember to
 * update. A stage with no invoice yet is `ready` when its evidence is in and
 * `gated` when it is not, which is the distinction the whole surface turns on.
 */
async function buildStages(jobId: string): Promise<StageRow[]> {
  const rows = await db
    .select({
      id: drawSchedule.id,
      name: drawSchedule.name,
      amountCents: drawSchedule.amountCents,
      gate: drawSchedule.gate,
      position: drawSchedule.position,
      phaseKey: drawSchedule.phaseKey,
      invoiceId: drawSchedule.invoiceId,
      invoiceStatus: documents.status,
      invoiceDueOn: invoiceDetails.dueOn,
      paidCents: sql<string>`${collectedForInvoice(sql.raw('"draw_schedule"."invoice_id"'))}::text`,
    })
    .from(drawSchedule)
    .leftJoin(documents, eq(drawSchedule.invoiceId, documents.id))
    .leftJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .where(eq(drawSchedule.jobId, jobId))
    .orderBy(asc(drawSchedule.position));

  // Evidence recorded but not yet attached to a bill is what makes a stage
  // billable — the proof that travels with the ask. It names its phase by id;
  // evidence from before phases had ids still matches by name.
  const readyPhases = await db
    .select({
      phaseId: evidence.drawScheduleId,
      phaseName: evidence.phaseName,
    })
    .from(evidence)
    .where(and(eq(evidence.jobId, jobId), sql`${evidence.invoiceId} is null`));

  const readyIds = new Set(
    readyPhases.flatMap((row) => (row.phaseId ? [row.phaseId] : []))
  );
  const inspectionResults = await db.select({ clearsPhase: inspections.clearsPhase, result: inspections.result })
    .from(inspections).where(eq(inspections.jobId, jobId)).orderBy(desc(inspections.createdAt), desc(inspections.id));
  const inspectionReady = passedInspectionPhases(inspectionResults);
  const readyNames = new Set(
    readyPhases.flatMap((row) =>
      row.phaseId ? [] : [row.phaseName.trim().toLowerCase()]
    )
  );

  return rows.map((row) => {
    const paidCents = Number(row.paidCents);
    const evidenceReady =
      readyIds.has(row.id) || readyNames.has(row.name.trim().toLowerCase());

    const state: StageRow["state"] =
      row.invoiceStatus === "paid" ||
      (row.invoiceId !== null && paidCents >= row.amountCents)
        ? "paid"
        : row.invoiceId
          ? "sent"
          : (row.gate === "inspection_passed" ? inspectionReady.has(row.name.trim().toLowerCase()) : evidenceReady || row.gate === "on_acceptance")
            ? "ready"
            : "gated";

    return {
      id: row.id,
      name: row.name,
      amountCents: row.amountCents,
      gate: row.gate,
      position: row.position,
      phaseKey: row.phaseKey,
      invoiceId: row.invoiceId,
      invoiceStatus: row.invoiceStatus,
      paidCents,
      state,
      detail: describe(state, row.gate, row.invoiceDueOn),
      evidenceReady,
    };
  });
}

/** The stage's status in the hub's voice — the mechanism, plainly. */
function describe(
  state: StageRow["state"],
  gate: StageRow["gate"],
  dueOn: string | null
): string {
  if (state === "paid") return "Paid";
  if (state === "sent") return dueOn ? `Sent · due ${dueOn}` : "Sent, waiting on her";
  if (state === "ready") return "Ready to bill";

  switch (gate) {
    case "inspection_passed":
      return "Bill this when the inspection passes";
    case "on_completion":
      return "Bill this when the job's done";
    case "on_acceptance":
      return "Due on acceptance";
    default:
      return "Bill this when the phase is done";
  }
}

/* ── Permits ──────────────────────────────────────────────────────────── */

async function buildPermits(jobId: string) {
  const permitRows = await db
    .select({
      id: permits.id,
      jurisdiction: permits.jurisdiction,
      number: permits.number,
      status: permits.status,
      issuedOn: permits.issuedOn,
    })
    .from(permits)
    .where(eq(permits.jobId, jobId))
    .orderBy(asc(permits.createdAt));

  if (permitRows.length === 0) return [];

  const inspectionRows = await db
    .select({
      id: inspections.id,
      permitId: inspections.permitId,
      type: inspections.type,
      result: inspections.result,
      scheduledOn: inspections.scheduledOn,
      completedOn: inspections.completedOn,
    })
    .from(inspections)
    .where(eq(inspections.jobId, jobId))
    .orderBy(asc(inspections.scheduledOn));

  return permitRows.map((permit) => ({
    ...permit,
    // Nested rather than listed top-level: an inspection has no life outside
    // the permit that scheduled it.
    inspections: inspectionRows.filter((row) => row.permitId === permit.id),
  }));
}

/* ── The quiet rows ───────────────────────────────────────────────────── */

async function buildDocuments(jobId: string): Promise<JobHub["documents"]> {
  const [[quote], [contract], [counts]] = await Promise.all([
    db
      .select({ id: documents.id, number: documents.number })
      .from(documents)
      .where(and(eq(documents.jobId, jobId), eq(documents.type, "quote")))
      .orderBy(desc(documents.createdAt))
      .limit(1),
    db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.jobId, jobId), eq(documents.type, "contract")))
      .orderBy(desc(documents.createdAt))
      .limit(1),
    db
      .select({
        changeOrderCount: sql<number>`(
          select count(*)::int from documents co
          where co.job_id = ${jobId} and co.type = 'change_order'
        )`,
        receiptCount: sql<number>`(
          select count(*)::int from receipts r where r.job_id = ${jobId}
        )`,
        receiptTotalCents: sql<number>`(
          select coalesce(sum(r.amount_cents), 0)::int
          from receipts r where r.job_id = ${jobId}
        )`,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1),
  ]);

  return {
    quoteId: quote?.id ?? null,
    quoteNumber: quote?.number ?? null,
    contractId: contract?.id ?? null,
    changeOrderCount: counts?.changeOrderCount ?? 0,
    receiptCount: counts?.receiptCount ?? 0,
    receiptTotalCents: counts?.receiptTotalCents ?? 0,
  };
}

/* ── The one action ───────────────────────────────────────────────────── */

/**
 * Whatever the job needs next, and nothing else.
 *
 * The order matters: money already earned outranks money not yet earned, and
 * both outrank tidying. When there is genuinely nothing to do the answer is
 * `null` — a hub that always shows a button invents work.
 */
function nextAction(
  jobId: string,
  stages: StageRow[],
  status: (typeof jobs.status.enumValues)[number],
  proposed: ProposedPlan | null
): JobHub["nextAction"] | null {
  const ready = stages.find((row) => row.state === "ready");
  if (ready) {
    return {
      label: `${ready.name} — bill it`,
      href: `/jobs/${jobId}/invoices/new?stage=${ready.id}`,
    };
  }

  const sent = stages.find((row) => row.state === "sent");
  if (sent) {
    return {
      label: "Chase the invoice",
      href: sent.invoiceId ? `/invoices/${sent.invoiceId}` : `/jobs/${jobId}/money`,
    };
  }

  if (status === "complete" || status === "paid") return null;

  // Nothing billable and nothing out: the next money is behind the next
  // phase, and marking it complete is what opens it.
  const waiting = stages.find((row) => row.state === "gated");
  if (waiting) {
    return {
      label: `${waiting.name} done? Mark it complete`,
      href: `/jobs/${jobId}/complete?phase=${waiting.id}`,
    };
  }

  if (stages.length === 0 && proposed) {
    // The plan is on the quote, so the next step is the quote: finishing it,
    // or seeing where it stands while she decides.
    return proposed.quoteStatus === "draft"
      ? { label: "Finish the quote", href: `/quotes/${proposed.quoteId}` }
      : { label: "See where the quote stands", href: `/quotes/${proposed.quoteId}/sent` };
  }

  if (stages.length === 0) {
    // Nothing planned yet. The honest next step is the plan, not a bill.
    return {
      label: "Plan how this job gets paid",
      href: `/jobs/${jobId}/money#phases`,
    };
  }

  return null;
}
