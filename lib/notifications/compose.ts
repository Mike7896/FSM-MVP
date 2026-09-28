import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  contractDetails,
  customers,
  documents,
  inspections,
  invoiceDetails,
  jobs,
  ledgerEntries,
  licenses,
  changeRequests,
  notificationSettings,
  tasks,
  visits,
} from "@/lib/db/schema";
import { collectedForInvoice } from "@/lib/ledger";
import { titleOf } from "@/lib/schedule/title";
import { quoteTotalExpression } from "@/lib/queries/scope-sql";
import { formatMoney } from "@/lib/quote/money";

/**
 * An event, re-read from the database and put into words.
 *
 * **Events carry ids, never sentences.** The emitter says *what* happened; this
 * reads the state as it now stands, decides whether it is still true, and says
 * it. That matters because notifications go out after the response: an
 * acceptance whose transaction rolled back, or an invoice paid in the minute
 * since it went overdue, comes back `null` here, and nobody is told something
 * false.
 *
 * The words follow Content Design §7.6. The title names the state; money names
 * the amount; a customer is named; and the body adds a fact rather than
 * repeating the title — so the subject line alone is the whole news, and
 * opening the email is still worth something.
 */

type EventBase = {
  organizationId: string;
  /**
   * The person here who did it, when it was one. They are never told: a
   * notification about what you just did is a status.
   */
  actorUserId?: string | null;
};

export type NotificationEvent = EventBase &
  (
    | { kind: "quote.viewed"; documentId: string }
    | { kind: "quote.accepted"; documentId: string }
    | { kind: "payment.received"; ledgerEntryId: string }
    | { kind: "invoice.overdue"; documentId: string }
    | { kind: "license.renewal"; licenseId: string }
    | { kind: "change.requested"; requestId: string }
    | { kind: "inspection.result"; inspectionId: string }
    | {
        kind: "visit.booked";
        visitId: string;
        /** The person booked — the only one told. */
        userId: string;
        /** The booker's clock, for the times in the words when theirs isn't known. */
        timeZone?: string;
      }
    | {
        kind: "task.assigned";
        taskId: string;
        /** The person given it — the only one told. */
        userId: string;
      }
  );

export type ComposedNotification = {
  title: string;
  body: string;
  href: string;
  dedupeKey: string;
  /** Who to tell besides the owners and admins — whoever sent the document. */
  alsoTo: string[];
  /**
   * Tell `alsoTo` and nobody else. A booking is news to the person booked;
   * to the owner who made it, it's their own diary.
   */
  only?: boolean;
};

/** Anything that can read: the pool, or a check script's transaction. */
type Reader = Pick<typeof db, "select">;

/** How long an expired license is still news. Past this it is a record. */
export const LICENSE_LOOKBACK_DAYS = 30;

/** The reminder window when a license doesn't set its own — the column default. */
export const DEFAULT_RENEWAL_REMINDER_DAYS = 60;

export async function compose(
  event: NotificationEvent,
  on: Reader = db
): Promise<ComposedNotification | null> {
  switch (event.kind) {
    case "change.requested": {
      const [row] = await on.select({ request: changeRequests, jobId: documents.jobId, demo: jobs.isDemo }).from(changeRequests).innerJoin(documents, eq(documents.id, changeRequests.contractId)).innerJoin(jobs, eq(jobs.id, documents.jobId)).where(and(eq(changeRequests.id, event.requestId), eq(documents.organizationId, event.organizationId)));
      if (!row || !row.request.submittedAt || row.demo) return null;
      return { title: "Your customer requested a change", body: row.request.body.slice(0, 300), href: `/jobs/${row.jobId}/change-orders`, dedupeKey: `change.requested:${row.request.id}`, alsoTo: [] };
    }
    case "quote.viewed":
      return quoteViewed(event.organizationId, event.documentId, on);
    case "quote.accepted":
      return quoteAccepted(event.organizationId, event.documentId, on);
    case "payment.received":
      return paymentReceived(event.organizationId, event.ledgerEntryId, on);
    case "invoice.overdue":
      return invoiceOverdue(event.organizationId, event.documentId, on);
    case "license.renewal":
      return licenseRenewal(event.organizationId, event.licenseId, on);
    case "inspection.result":
      return inspectionResult(event.organizationId, event.inspectionId, on);
    case "visit.booked":
      return visitBooked(event, on);
    case "task.assigned":
      return taskAssigned(event, on);
  }
}

/* ── Tasks ────────────────────────────────────────────────────────────── */

async function taskAssigned(
  event: Extract<NotificationEvent, { kind: "task.assigned" }>,
  on: Reader
): Promise<ComposedNotification | null> {
  const [row] = await on
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      assigneeId: tasks.assigneeId,
      dueOn: tasks.dueOn,
      jobName: jobs.name,
      customerName: customers.name,
      demo: jobs.isDemo,
    })
    .from(tasks)
    .leftJoin(jobs, eq(tasks.jobId, jobs.id))
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(eq(tasks.id, event.taskId), eq(tasks.organizationId, event.organizationId)))
    .limit(1);

  // Re-read: handed to someone else, finished or deleted since is not news.
  if (
    !row ||
    row.assigneeId !== event.userId ||
    row.status === "done" ||
    row.status === "cancelled" ||
    row.demo
  ) {
    return null;
  }

  const job = [row.customerName?.trim().split(/\s+/).at(-1), row.jobName?.trim()]
    .filter(Boolean)
    .join(" · ");
  const due = row.dueOn
    ? `Due ${new Date(`${row.dueOn}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}.`
    : null;

  return {
    title: `New task for you: ${row.title}`,
    body: [job ? `On ${job}.` : null, due].filter(Boolean).join(" ") || "It's on your task list.",
    href: `/tasks?task=${row.id}`,
    dedupeKey: `task.assigned:${row.id}:${event.userId}`,
    alsoTo: [event.userId],
    only: true,
  };
}

/* ── The schedule ─────────────────────────────────────────────────────── */

async function visitBooked(
  event: Extract<NotificationEvent, { kind: "visit.booked" }>,
  on: Reader
): Promise<ComposedNotification | null> {
  const [row] = await on
    .select({
      id: visits.id,
      kind: visits.kind,
      status: visits.status,
      title: visits.title,
      allDay: visits.allDay,
      startsAt: visits.startsAt,
      endsAt: visits.endsAt,
      startsOn: visits.startsOn,
      endsOn: visits.endsOn,
      jobName: jobs.name,
      address: jobs.address,
      customerName: customers.name,
      demo: jobs.isDemo,
      assigned: sql<boolean>`exists (
        select 1 from visit_assignees a
        where a.visit_id = ${visits.id} and a.user_id = ${event.userId}
      )`,
      theirZone: notificationSettings.timeZone,
    })
    .from(visits)
    .leftJoin(jobs, eq(visits.jobId, jobs.id))
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(notificationSettings, eq(notificationSettings.userId, event.userId))
    .where(
      and(eq(visits.id, event.visitId), eq(visits.organizationId, event.organizationId))
    )
    .limit(1);

  // Re-read, like every event: taken off it, cancelled or deleted since the
  // booking was made is not news any more.
  if (!row || !row.assigned || row.status !== "scheduled" || row.demo) return null;

  const zone = row.theirZone ?? event.timeZone ?? "UTC";
  const what = titleOf(row.kind, row.title, row.jobName, row.customerName);
  const when = row.allDay
    ? dayRange(row.startsOn!, row.endsOn!)
    : `${dayOf(row.startsAt!, zone)}, ${clockOf(row.startsAt!, zone)} – ${clockOf(row.endsAt!, zone)}`;

  return {
    title: `You're booked: ${what} — ${when}`,
    body: row.address?.trim() ? `At ${row.address.trim()}.` : "Details are on the schedule.",
    href: `/schedule?date=${row.startsOn ?? localISODate(row.startsAt!, zone)}&visit=${row.id}`,
    // Keyed on the time too, so a reschedule is news again.
    dedupeKey: `visit.booked:${row.id}:${event.userId}:${row.startsAt?.toISOString() ?? `${row.startsOn}/${row.endsOn}`}`,
    alsoTo: [event.userId],
    only: true,
  };
}

function dayOf(at: Date, timeZone: string) {
  return at.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
}

function clockOf(at: Date, timeZone: string) {
  return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

function dayRange(from: string, to: string) {
  const first = dateOf(from);
  return from === to ? `${first}, all day` : `${first} – ${dateOf(to)}`;
}

function localISODate(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/* ── Permits ──────────────────────────────────────────────────────────── */

const INSPECTION_NAMES = {
  underground: "underground",
  rough_in: "rough-in",
  service: "service",
  final: "final",
} as const;

async function inspectionResult(
  organizationId: string,
  inspectionId: string,
  on: Reader
): Promise<ComposedNotification | null> {
  const [row] = await on
    .select({
      id: inspections.id,
      type: inspections.type,
      result: inspections.result,
      permitId: inspections.permitId,
      corrections: inspections.correctionsRequired,
      notes: inspections.inspectorNotes,
      jobId: jobs.id,
      jobName: jobs.name,
      demo: jobs.isDemo,
    })
    .from(inspections)
    .innerJoin(jobs, eq(inspections.jobId, jobs.id))
    .where(
      and(eq(inspections.id, inspectionId), eq(jobs.organizationId, organizationId))
    )
    .limit(1);

  // Only a result is news. Scheduled and cancelled are the contractor's own
  // bookkeeping, recorded by whoever is looking at the permit.
  if (!row || row.demo || (row.result !== "passed" && row.result !== "failed")) {
    return null;
  }

  const which = `The ${INSPECTION_NAMES[row.type]} inspection on ${jobName(row.jobName)}`;
  const failed = row.result === "failed";

  return {
    title: failed ? `${which} failed` : `${which} passed`,
    body: failed
      ? row.corrections?.trim()
        ? `Corrections required: ${row.corrections.trim().slice(0, 240)}`
        : "The corrections list is on the permit."
      : row.notes?.trim()
        ? `Inspector's notes: ${row.notes.trim().slice(0, 240)}`
        : "Nothing is holding the next phase back on this one.",
    href: `/jobs/${row.jobId}/permits/${row.permitId}`,
    // Keyed on the result too: a fail and then a pass on re-inspection are two
    // pieces of news.
    dedupeKey: `inspection.result:${row.id}:${row.result}`,
    alsoTo: [],
  };
}

/**
 * Drizzle renders an embedded column unqualified inside a `sql` template in a
 * projection, which is ambiguous inside the correlated subqueries below.
 */
const DOCUMENT_ID = sql.raw('"documents"."id"');

/* ── Quotes ───────────────────────────────────────────────────────────── */

async function readQuote(
  organizationId: string,
  documentId: string,
  on: Reader
) {
  const [quote] = await on
    .select({
      id: documents.id,
      type: documents.type,
      status: documents.status,
      number: documents.number,
      title: documents.title,
      jobId: documents.jobId,
      sentAt: documents.sentAt,
      createdBy: documents.createdBy,
      customerName: customers.name,
      demo: jobs.isDemo,
      // The expression every list reads, so the figure here is the figure on
      // the quote.
      totalCents: sql<string>`${quoteTotalExpression(DOCUMENT_ID)}::text`,
    })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.organizationId, organizationId)
      )
    )
    .limit(1);

  // A demo went to the contractor alone and never counts toward anything —
  // this included.
  if (!quote || quote.type !== "quote" || quote.demo) return null;
  return quote;
}

async function quoteViewed(
  organizationId: string,
  documentId: string,
  on: Reader
): Promise<ComposedNotification | null> {
  const quote = await readQuote(organizationId, documentId, on);
  if (!quote || quote.status === "draft" || quote.status === "sent") {
    return null;
  }

  return {
    title: `${quote.customerName} opened ${quoteName(quote)}`,
    body: [
      // The number only when the title didn't already use it.
      quote.title?.trim() ? quote.number : null,
      formatMoney(Number(quote.totalCents)),
      quote.sentAt ? `sent ${dateOf(quote.sentAt)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    href: `/quotes/${quote.id}`,
    dedupeKey: `quote.viewed:${quote.id}`,
    alsoTo: quote.createdBy ? [quote.createdBy] : [],
  };
}

async function quoteAccepted(
  organizationId: string,
  documentId: string,
  on: Reader
): Promise<ComposedNotification | null> {
  const quote = await readQuote(organizationId, documentId, on);
  // Checked rather than assumed: an acceptance that rolled back must not
  // announce itself.
  if (!quote || quote.status !== "accepted") return null;

  const [contract] = await on
    .select({
      sumCents: contractDetails.contractSumCents,
      depositCents: contractDetails.depositCents,
    })
    .from(documents)
    .innerJoin(contractDetails, eq(contractDetails.documentId, documents.id))
    .where(
      and(
        eq(documents.sourceDocumentId, quote.id),
        eq(documents.type, "contract")
      )
    )
    .orderBy(desc(documents.createdAt))
    .limit(1);

  const deposit = contract?.depositCents ?? 0;
  const total = contract?.sumCents ?? Number(quote.totalCents);
  const approved = `${quote.customerName} approved ${quoteName(quote)}`;

  return {
    // Content Design §7.6's own example: "The Patels approved the panel quote —
    // $1,800 deposit is due".
    title:
      deposit > 0
        ? `${approved} — ${formatMoney(deposit)} deposit is due`
        : approved,
    body: `${quote.number} is a ${formatMoney(total)} contract now, ready for signatures.`,
    href: `/jobs/${quote.jobId}/contract`,
    dedupeKey: `quote.accepted:${quote.id}`,
    alsoTo: quote.createdBy ? [quote.createdBy] : [],
  };
}

/** "the panel upgrade quote" — or its number, when it has no title to use. */
function quoteName(quote: { title: string | null; number: string }) {
  const title = quote.title?.trim();
  return title ? `the ${lower(title)} quote` : quote.number;
}

/* ── Money ────────────────────────────────────────────────────────────── */

const INVOICE_NAMES = {
  deposit: "deposit",
  draw: "draw",
  final_balance: "final balance",
} as const;

async function paymentReceived(
  organizationId: string,
  ledgerEntryId: string,
  on: Reader
): Promise<ComposedNotification | null> {
  const [entry] = await on
    .select({
      id: ledgerEntries.id,
      entryType: ledgerEntries.entryType,
      amountCents: ledgerEntries.amountCents,
      jobId: ledgerEntries.jobId,
      invoiceId: ledgerEntries.invoiceId,
      jobName: jobs.name,
      demo: jobs.isDemo,
      customerName: customers.name,
    })
    .from(ledgerEntries)
    .innerJoin(jobs, eq(ledgerEntries.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(ledgerEntries.id, ledgerEntryId),
        eq(ledgerEntries.organizationId, organizationId)
      )
    )
    .limit(1);

  // Money on no job has no screen to send anyone to yet, so it stays in the
  // ledger rather than becoming a notification that links nowhere.
  if (!entry || entry.entryType !== "payment_received" || entry.demo) {
    return null;
  }

  const paid = formatMoney(entry.amountCents);
  const work = jobName(entry.jobName);
  const where = {
    href: `/jobs/${entry.jobId}`,
    dedupeKey: `payment.received:${entry.id}`,
    alsoTo: [],
  };

  const [invoice] = entry.invoiceId
    ? await on
        .select({
          number: documents.number,
          type: invoiceDetails.invoiceType,
          amountDueCents: invoiceDetails.amountDueCents,
          collectedCents: sql<string>`${collectedForInvoice(DOCUMENT_ID)}::text`,
        })
        .from(documents)
        .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
        .where(eq(documents.id, entry.invoiceId))
        .limit(1)
    : [];

  if (!invoice) {
    return {
      ...where,
      title: `${entry.customerName} paid ${paid}`,
      body: `It's on ${work}, not against an invoice yet.`,
    };
  }

  const name = INVOICE_NAMES[invoice.type];
  const owing = invoice.amountDueCents - Number(invoice.collectedCents);

  return {
    ...where,
    title:
      entry.amountCents >= invoice.amountDueCents
        ? `${entry.customerName} paid the ${paid} ${name}`
        : `${entry.customerName} paid ${paid} toward the ${name}`,
    body:
      owing <= 0
        ? `That settles ${invoice.number} on ${work}.`
        : `${invoice.number} on ${work} still has ${formatMoney(owing)} owing.`,
  };
}

async function invoiceOverdue(
  organizationId: string,
  documentId: string,
  on: Reader
): Promise<ComposedNotification | null> {
  const [invoice] = await on
    .select({
      id: documents.id,
      number: documents.number,
      status: documents.status,
      dueOn: invoiceDetails.dueOn,
      voidedAt: invoiceDetails.voidedAt,
      amountDueCents: invoiceDetails.amountDueCents,
      collectedCents: sql<string>`${collectedForInvoice(DOCUMENT_ID)}::text`,
      customerName: customers.name,
      demo: jobs.isDemo,
    })
    .from(documents)
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "invoice")
      )
    )
    .limit(1);

  const today = todayISO();
  if (
    !invoice ||
    invoice.demo ||
    invoice.voidedAt ||
    !invoice.dueOn ||
    invoice.dueOn >= today
  ) {
    return null;
  }

  // A draft was never sent to anyone, and a paid or voided bill isn't owed.
  if (["draft", "paid", "void"].includes(invoice.status)) return null;

  const owing = invoice.amountDueCents - Number(invoice.collectedCents);
  if (owing <= 0) return null;

  const late = count(daysBetween(invoice.dueOn, today), "day");

  return {
    title: `${invoice.customerName} is ${late} late on ${formatMoney(owing)}`,
    body: `${invoice.number} was due ${dateOf(invoice.dueOn)}.`,
    href: `/invoices/${invoice.id}`,
    dedupeKey: `invoice.overdue:${invoice.id}`,
    alsoTo: [],
  };
}

/* ── The Office ───────────────────────────────────────────────────────── */

async function licenseRenewal(
  organizationId: string,
  licenseId: string,
  on: Reader
): Promise<ComposedNotification | null> {
  const [license] = await on
    .select({
      id: licenses.id,
      jurisdiction: licenses.jurisdiction,
      number: licenses.number,
      expiresOn: licenses.expiresOn,
      reminderDays: licenses.renewalReminderDays,
    })
    .from(licenses)
    .where(
      and(eq(licenses.id, licenseId), eq(licenses.organizationId, organizationId))
    )
    .limit(1);

  if (!license?.expiresOn) return null;

  const days = daysBetween(todayISO(), license.expiresOn);
  const window = license.reminderDays ?? DEFAULT_RENEWAL_REMINDER_DAYS;
  if (days > window || days < -LICENSE_LOOKBACK_DAYS) return null;

  const yours = `Your ${license.jurisdiction} license`;

  return {
    title:
      days > 0
        ? `${yours} expires in ${count(days, "day")}`
        : days === 0
          ? `${yours} expires today`
          : `${yours} expired ${count(-days, "day")} ago`,
    body:
      `#${license.number} ${days < 0 ? "ran" : "runs"} out on ` +
      `${dateOf(license.expiresOn, { year: true })}. Once it's renewed, ` +
      `update the date so the next reminder comes on time.`,
    href: "/office/licenses",
    // Keyed on the date as well as the license: renewing moves the date, and
    // the next renewal deserves a reminder of its own.
    dedupeKey: `license.renewal:${license.id}:${license.expiresOn}`,
    alsoTo: [],
  };
}

/* ── Wording ──────────────────────────────────────────────────────────── */

/** "the panel upgrade job", or just "the job". */
function jobName(name: string | null) {
  const trimmed = name?.trim();
  return trimmed ? `the ${lower(trimmed)} job` : "the job";
}

function lower(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function count(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days from one calendar date to another; negative when `to` is earlier. */
function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000
  );
}

/** "Sep 15", or "Sep 15, 2026" — from a timestamp or a calendar date. */
function dateOf(value: Date | string, options?: { year?: boolean }) {
  const date =
    typeof value === "string" ? new Date(`${value}T12:00:00Z`) : value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: options?.year ? "numeric" : undefined,
    timeZone: "UTC",
  });
}
