import "server-only";

import { getAccess } from "@/lib/membership/access";
import { dashboardDate, dashboardHorizon, quoteFollowUp } from "@/lib/dashboard";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  documents,
  drawSchedule,
  evidence,
  inspections,
  invoiceDetails,
  jobs,
  tasks,
  visits,
} from "@/lib/db/schema";
import { collectedForInvoice } from "@/lib/ledger";
import { money, openGates, surname, when } from "@/lib/queries/gates";
import { titleOf } from "@/lib/schedule/title";
import { jobMoney } from "@/lib/queries/jobs";
import { listQuotePreviews } from "@/lib/queries/quotes";
import { quoteTotalExpression } from "@/lib/queries/scope-sql";

/**
 * The dashboard, derived.
 *
 * It answers one question — *what am I cleared, required, or smart to do next?*
 * — in five seconds, or it has failed. Two rules follow from that and both
 * shape this file rather than only the page:
 *
 * **Every row is a sentence about a real job with a verb attached.** Not one
 * metric on the surface; a stat-card homepage is the named anti-pattern. So this
 * module returns *sentences*, not counts — and builds them here rather than in
 * the page, because `/api/v1/dashboard` serves the same rows to the native app
 * and the two must not word the same fact differently.
 *
 * **Sections collapse when empty.** An empty gate list is a good outcome, not a
 * state to display. The only section that always renders is "this week", where
 * *nothing scheduled* is genuinely information. The web groups it into Today
 * and Coming up; due tasks also appear among the next actions.
 *
 * Everything here is **derived at read time**, and scoped to an organization
 * the caller proved through `requireOrg` or `requireActiveOrganization`.
 */

/**
 * Drizzle renders an embedded column **unqualified** inside a `sql` template in
 * a `.select()` projection, which is ambiguous inside a correlated subquery
 * (42702). This is the explicit reference.
 */
const DOCUMENT_ID = sql.raw('"documents"."id"');

export type DashboardRow = {
  /** `**name**` marks the emphasis the page renders bold. */
  sentence: string;
  detail: string;
  action: string;
  href: string;
  needsAction?: boolean;
};

export type DashboardScheduleItem = {
  key: string;
  title: string;
  address: string | null;
  when: string;
  at: string | null;
  on: string;
  href: string;
  kind: "job" | "inspection" | "visit" | "task";
  overdue: boolean;
};

export type DashboardData = {
  today: string;
  timeZone: string;
  clearedToProceed: DashboardRow[];
  waitingOnCustomer: DashboardRow[];
  moneyToCollect: { totalCents: number; rows: DashboardRow[] };
  /**
   * `when` is a weekday; `at`, when there is one, is the instant a timed visit
   * starts — printed by the browser, which knows the clock it's read on.
   */
  thisWeek: DashboardScheduleItem[];
  quickStart: {
    label: string;
    href: string;
    id: string;
    number: string | null;
    title: string | null;
    status: string;
    customerName: string;
    totalCents: number;
    rows: { description: string; amountCents: number; unpriced: boolean }[];
  }[];
  /** Available actions, including tasks due today or overdue. */
  needsYou: number;
};

export async function getDashboard(
  organizationId: string,
  timeZone = "UTC"
): Promise<DashboardData> {
  const today = dashboardDate(new Date(), timeZone);
  const [cleared, waiting, unbilled, overdue, week, recent] = await Promise.all([
    clearedToProceed(organizationId),
    waitingOnCustomer(organizationId),
    earnedButUnbilled(organizationId),
    overdueInvoices(organizationId, today),
    thisWeek(organizationId, today, timeZone),
    quickStart(organizationId),
  ]);

  const moneyRows = [...overdue.rows, ...unbilled.rows];

  return {
    today,
    timeZone,
    clearedToProceed: cleared,
    waitingOnCustomer: waiting,
    moneyToCollect: {
      totalCents: unbilled.totalCents + overdue.totalCents,
      rows: moneyRows,
    },
    thisWeek: week,
    quickStart: recent,
    needsYou: cleared.length + waiting.filter((row) => row.needsAction).length + moneyRows.length
      + week.filter((item) => item.kind === "task" && item.on <= today).length,
  };
}

/* ── Cleared to proceed ───────────────────────────────────────────────── */

/**
 * A gate just opened and the contractor is permitted to work.
 *
 * Derived in `lib/queries/gates.ts`, because the job list states the same fact
 * in its triage band — and a gate is the one thing that must not be described
 * two ways on two screens a click apart.
 */
async function clearedToProceed(
  organizationId: string
): Promise<DashboardRow[]> {
  const gates = await openGates(organizationId);

  return [...gates.values()].map((gate) => ({
    sentence: gate.sentence,
    detail: gate.detail,
    action: "Open job",
    href: `/jobs/${gate.jobId}`,
  }));
}

/* ── Waiting on customer ──────────────────────────────────────────────── */

/**
 * Quotes that have gone out and not come back.
 *
 * Show only observed facts. A quote sent or viewed recently is context;
 * three days without activity makes it a suggested follow-up.
 */
async function waitingOnCustomer(
  organizationId: string
): Promise<DashboardRow[]> {
  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      title: documents.title,
      status: documents.status,
      sentAt: documents.sentAt,
      viewedAt: documents.viewedAt,
      customerName: customers.name,
      // The one expression every surface reads, so the number he is chasing
      // here is the number on the quote he sent.
      totalCents: sql<string>`${quoteTotalExpression(DOCUMENT_ID)}::text`,
    })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.type, "quote"),
        // A demo is never waiting on anyone — it went to him.
        eq(jobs.isDemo, false),
        inArray(documents.status, ["sent", "viewed"])
      )
    )
    .orderBy(asc(documents.sentAt));

  // Whether she opened it is quote-view tracking — Pro only (Billing §2.2).
  // Without it the row says only what is known: no answer yet.
  const { features } = await getAccess(organizationId);

  return rows.map((row) => {
    const work = row.title ?? `quote ${row.number}`;
    const opened = features.viewTracking && row.status === "viewed" ? row.viewedAt : null;
    const followUp = quoteFollowUp(row.sentAt, opened, features.viewTracking);

    return {
      sentence: !features.viewTracking
        ? `**${row.customerName}** hasn't answered the ${lower(work)} quote yet.`
        : opened
          ? `**${row.customerName}** viewed the ${lower(work)} quote.`
          : `**${row.customerName}** hasn't opened the ${lower(work)} quote yet.`,
      detail: [
        row.sentAt ? `Sent ${when(row.sentAt)}` : "Not sent",
        ...(opened ? [`Viewed ${when(opened)}`] : []),
        money(Number(row.totalCents)),
      ].join(" · "),
      // Hidden view tracking never influences the action for a free account.
      action: followUp ? "Follow up" : "View quote",
      needsAction: followUp,
      href: `/quotes/${row.id}`,
    };
  });
}

/* ── Money to collect ─────────────────────────────────────────────────── */

/**
 * Work that is done and not yet billed.
 *
 * Evidence with no invoice behind it is the definition: a phase signed off,
 * photographed, and never turned into a draw — money the contractor has already
 * spent labour and materials earning.
 */
async function earnedButUnbilled(organizationId: string) {
  const rows = await db
    .select({
      jobId: jobs.id,
      customerName: customers.name,
      phaseName: evidence.phaseName,
      phaseId: evidence.drawScheduleId,
      phaseCents: drawSchedule.amountCents,
      completedAt: evidence.completedAt,
    })
    .from(evidence)
    .innerJoin(jobs, eq(evidence.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(drawSchedule, eq(evidence.drawScheduleId, drawSchedule.id))
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        eq(jobs.isDemo, false),
        isNull(evidence.invoiceId),
        isNotNull(evidence.completedAt)
      )
    )
    .orderBy(asc(evidence.completedAt));

  // A planned phase carries its own amount. Evidence from before phases had
  // ids falls back to the job's unbilled balance — counted once per job.
  const state = await jobMoney(rows.map((row) => row.jobId));

  let totalCents = 0;
  const counted = new Set<string>();
  const out: DashboardRow[] = [];
  const phases = new Set<string>();

  for (const row of rows) {
    // Multiple evidence entries can describe the same completed phase.
    if (row.phaseId && phases.has(row.phaseId)) continue;
    if (row.phaseId) phases.add(row.phaseId);
    const job = state.get(row.jobId);
    const unbilled =
      row.phaseCents ??
      Math.max((job?.totalCents ?? 0) - (job?.billedCents ?? 0), 0);

    if (row.phaseCents !== null) {
      totalCents += unbilled;
    } else if (!counted.has(row.jobId)) {
      counted.add(row.jobId);
      totalCents += unbilled;
    }

    out.push({
      sentence: `${capitalize(row.phaseName)}'s signed off at **${surname(row.customerName)}** — you haven't billed it.`,
      detail:
        unbilled > 0 ? `${money(unbilled)} earned, unbilled` : "Ready to bill",
      action: "Bill it",
      // A planned phase is billed where it was marked complete.
      href: row.phaseId
        ? `/jobs/${row.jobId}/complete?phase=${row.phaseId}`
        : `/jobs/${row.jobId}/money`,
    });
  }

  return { rows: out, totalCents };
}

/**
 * Invoices past their due date and not settled.
 *
 * Counted net of whatever has actually been paid against them, so a partly-paid
 * invoice shows what is still owed rather than what it was issued for.
 */
async function overdueInvoices(organizationId: string, today: string) {

  const rows = await db
    .select({
      id: documents.id,
      type: invoiceDetails.invoiceType,
      dueOn: invoiceDetails.dueOn,
      amountDueCents: invoiceDetails.amountDueCents,
      customerName: customers.name,
      paidCents: sql<string>`${collectedForInvoice(DOCUMENT_ID)}::text`,
    })
    .from(documents)
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.type, "invoice"),
        // A demo invoice is never owed.
        eq(jobs.isDemo, false),
        notInArray(documents.status, ["draft", "paid", "void"]),
        isNull(invoiceDetails.voidedAt),
        isNotNull(invoiceDetails.dueOn),
        lt(invoiceDetails.dueOn, today)
      )
    )
    .orderBy(asc(invoiceDetails.dueOn));

  let totalCents = 0;
  const out: DashboardRow[] = [];

  for (const row of rows) {
    const owed = row.amountDueCents - Number(row.paidCents);
    if (owed <= 0) continue;
    totalCents += owed;

    const days = daysBetween(row.dueOn!, today);
    out.push({
      sentence: `**${row.customerName}**'s ${label(row.type)} is ${days} day${days === 1 ? "" : "s"} past due.`,
      detail: `${money(owed)} · due ${when(row.dueOn!)}`,
      action: "Chase",
      href: `/invoices/${row.id}`,
    });
  }

  return { rows: out, totalCents };
}

/* ── This week ────────────────────────────────────────────────────────── */

/**
 * What is actually on the calendar — jobs starting, visits booked,
 * inspections, and tasks falling due.
 *
 * Renders even when empty, unlike the action sections: *nothing scheduled* is
 * information a contractor wants. Time off stays on the schedule; this list is
 * the work. A task already past its date is here too, first — overdue is the
 * most pressing thing a week can hold.
 */
async function thisWeek(organizationId: string, today: string, timeZone: string): Promise<DashboardScheduleItem[]> {
  const horizon = dashboardHorizon(today);

  const [starting, booked, onSchedule, falling] = await Promise.all([
    db
      .select({
        id: jobs.id,
        name: jobs.name,
        address: jobs.address,
        startsOn: jobs.startsOn,
        customerName: customers.name,
      })
      .from(jobs)
      .innerJoin(customers, eq(jobs.customerId, customers.id))
      .where(
        and(
          eq(jobs.organizationId, organizationId),
          eq(jobs.isDemo, false),
          notInArray(jobs.status, ["complete", "paid"]),
          isNotNull(jobs.startsOn),
          gte(jobs.startsOn, today),
          lte(jobs.startsOn, horizon)
        )
      ),

    db
      .select({
        id: inspections.id,
        jobId: jobs.id,
        type: inspections.type,
        scheduledOn: inspections.scheduledOn,
        address: jobs.address,
        customerName: customers.name,
      })
      .from(inspections)
      .innerJoin(jobs, eq(inspections.jobId, jobs.id))
      .innerJoin(customers, eq(jobs.customerId, customers.id))
      .where(
        and(
          eq(jobs.organizationId, organizationId),
          eq(jobs.isDemo, false),
          eq(inspections.result, "scheduled"),
          isNotNull(inspections.scheduledOn),
          gte(inspections.scheduledOn, today),
          lte(inspections.scheduledOn, horizon)
        )
      ),

    db
      .select({
        id: visits.id,
        jobId: jobs.id,
        kind: visits.kind,
        title: visits.title,
        allDay: visits.allDay,
        startsAt: visits.startsAt,
        startsOn: visits.startsOn,
        jobName: jobs.name,
        address: jobs.address,
        customerName: customers.name,
      })
      .from(visits)
      .leftJoin(jobs, eq(visits.jobId, jobs.id))
      .leftJoin(customers, eq(jobs.customerId, customers.id))
      .where(
        and(
          eq(visits.organizationId, organizationId),
          eq(visits.status, "scheduled"),
          ne(visits.kind, "time_off"),
          or(isNull(visits.jobId), eq(jobs.isDemo, false)),
          or(
            and(
              eq(visits.allDay, false),
              sql`(${visits.startsAt} at time zone ${timeZone})::date >= ${today}::date`,
              sql`(${visits.startsAt} at time zone ${timeZone})::date <= ${horizon}::date`
            ),
            and(
              eq(visits.allDay, true),
              lte(visits.startsOn, horizon),
              gte(visits.endsOn, today)
            )
          )
        )
      ),

    db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueOn: tasks.dueOn,
        address: jobs.address,
      })
      .from(tasks)
      .leftJoin(jobs, eq(tasks.jobId, jobs.id))
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          notInArray(tasks.status, ["done", "cancelled"]),
          or(isNull(tasks.jobId), eq(jobs.isDemo, false)),
          isNotNull(tasks.dueOn),
          lte(tasks.dueOn, horizon)
        )
      ),
  ]);

  return [
    ...starting.map((row) => ({
      key: `job-${row.id}`,
      href: `/jobs/${row.id}`,
      kind: "job" as const,
      title: `Start ${surname(row.customerName)}${row.name ? ` — ${lower(row.name)}` : ""}`,
      address: row.address,
      sort: `${row.startsOn!}T00:00:00Z`,
      on: row.startsOn!,
      at: null,
    })),
    ...booked.map((row) => ({
      key: `inspection-${row.id}`,
      href: `/jobs/${row.jobId}`,
      kind: "inspection" as const,
      title: `${surname(row.customerName)} — ${row.type.replace(/_/g, " ")} inspection`,
      address: row.address,
      sort: `${row.scheduledOn!}T00:00:00Z`,
      on: row.scheduledOn!,
      at: null,
    })),
    ...onSchedule.map((row) => {
      // A visit that began before today and runs on is on today.
      const on = row.allDay
        ? row.startsOn! < today ? today : row.startsOn!
        : dashboardDate(row.startsAt!, timeZone);
      return {
        key: `visit-${row.id}`,
        href: row.jobId ? `/jobs/${row.jobId}` : `/schedule?date=${on}&visit=${row.id}`,
        kind: "visit" as const,
        title: titleOf(row.kind, row.title, row.jobName, row.customerName),
        address: row.address,
        sort: row.allDay ? `${on}T00:00:00Z` : row.startsAt!.toISOString(),
        on,
        at: row.allDay ? null : row.startsAt!.toISOString(),
      };
    }),
    ...falling.map((row) => {
      const late = row.dueOn! < today;
      return {
        key: `task-${row.id}`,
        href: `/tasks?task=${row.id}`,
        kind: "task" as const,
        title: row.title,
        address: row.address,
        // Late sorts before everything; otherwise it's due that day.
        sort: late ? `0000-${row.dueOn}` : `${row.dueOn!}T00:00:00Z`,
        on: row.dueOn!,
        at: null,
        late,
      };
    }),
  ]
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .map(({ key, title, address, on, at, href, kind, ...rest }) => ({
      key,
      title,
      address,
      on,
      href,
      kind,
      overdue: "late" in rest && rest.late,
      // A task is due by a day, not booked on it — said, so it never reads as
      // the visit booked to do it.
      when: "late" in rest ? (rest.late ? "Overdue" : `Due ${dayLabel(on)}`) : dayLabel(on),
      at,
    }));
}

/* ── Quick start ──────────────────────────────────────────────────────── */

/**
 * The last few real quotes, offered for duplication.
 *
 * The price book's cheapest form: the fastest way to price the next panel swap
 * is the last panel swap. Drafts are excluded — a quote he never finished is not
 * a template.
 */
async function quickStart(organizationId: string) {
  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      title: documents.title,
      status: documents.status,
      customerName: customers.name,
      totalCents: sql<string>`${quoteTotalExpression(DOCUMENT_ID)}::text`,
    })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.type, "quote"),
        // Real work only. The demo has its own row on a demo-only account.
        eq(jobs.isDemo, false),
        ne(documents.status, "draft")
      )
    )
    .orderBy(desc(documents.createdAt))
    .limit(3);

  if (rows.length === 0) return [];

  // The page each one is, so the contractor recognises it instead of reading a
  // label — picking which one is a recognition problem.
  const previews = await listQuotePreviews(
    rows.map((row) => row.id),
    3
  );

  return rows.map((row) => ({
    label: `Like the ${surname(row.customerName)} ${lower(row.title ?? "quote")}`,
    href: `/quotes/new?from=${row.id}`,
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    customerName: row.customerName,
    totalCents: Number(row.totalCents),
    rows: previews.get(row.id) ?? [],
  }));
}

/* ── Formatting ───────────────────────────────────────────────────────── */

function lower(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function label(type: string) {
  return type === "final_balance" ? "final invoice" : `${type} invoice`;
}

/** "Tue" / "Wed" for the week ahead. */
function dayLabel(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
  });
}

function daysBetween(from: string, to: string) {
  return Math.max(
    Math.round(
      (new Date(`${to}T12:00:00Z`).getTime() -
        new Date(`${from}T12:00:00Z`).getTime()) /
        86_400_000
    ),
    0
  );
}
