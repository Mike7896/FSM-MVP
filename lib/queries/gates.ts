import "server-only";

import { and, desc, eq, gt, gte, isNotNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  invoiceDetails,
  jobs,
  ledgerEntries,
  permits,
} from "@/lib/db/schema";

/**
 * Gates — the moments a contractor becomes **permitted** to work.
 *
 * This lives on its own because two surfaces state the same fact: the dashboard
 * frames it as its one permission block, and the job list carries it in a
 * triage band above the jobs. Deriving it twice is how the same deposit ends up
 * described two different ways on two screens a click apart, and a gate is
 * exactly the thing that must not be ambiguous — an error costs in both
 * directions, starting work that is not paid for or sitting on work that is.
 *
 * A gate is a **real event**, never a status somebody remembered to set: money
 * landing against a deposit or draw, or a permit reaching `issued`.
 *
 * Bounded to the recent past. A deposit that cleared in March is not news, and
 * a triage band that keeps announcing it is one a contractor stops reading.
 */

/** How long a gate opening still counts as news. */
export const GATE_WINDOW_DAYS = 14;

export type Gate = {
  jobId: string;
  kind: "deposit" | "draw" | "permit";
  customerName: string;
  /**
   * The full sentence, with `**name**` marking the emphasis. For surfaces that
   * show the gate on its own — the dashboard.
   */
  sentence: string;
  /**
   * The same fact without the name, for surfaces that already show the customer
   * beside it — the job list. Two forms of one string rather than two
   * derivations of one fact.
   */
  short: string;
  detail: string;
  /** Sort key: when the gate opened. */
  at: string;
};

/**
 * The open gate for each job that has one, keyed by job id.
 *
 * One gate per job — the most recent. A job whose deposit cleared *and* whose
 * permit came through does not need two rows saying it may proceed; it needs
 * the latest reason it may.
 */
export async function openGates(
  organizationId: string,
  options?: { limit?: number }
): Promise<Map<string, Gate>> {
  const cutoff = new Date(Date.now() - GATE_WINDOW_DAYS * 86_400_000);
  const since = cutoff.toISOString().slice(0, 10);
  const limit = options?.limit ?? 20;

  const [paid, issued] = await Promise.all([
    db
      .select({
        jobId: jobs.id,
        customerName: customers.name,
        amountCents: ledgerEntries.amountCents,
        occurredAt: ledgerEntries.occurredAt,
        invoiceType: invoiceDetails.invoiceType,
      })
      .from(ledgerEntries)
      .innerJoin(jobs, eq(ledgerEntries.jobId, jobs.id))
      .innerJoin(customers, eq(jobs.customerId, customers.id))
      .innerJoin(
        invoiceDetails,
        eq(invoiceDetails.documentId, ledgerEntries.invoiceId)
      )
      .where(
        and(
          eq(ledgerEntries.organizationId, organizationId),
          // A demo job never opens a gate. Its money is not money.
          eq(jobs.isDemo, false),
          // Money *in*. A refund and a chargeback are also ledger rows against
          // the same invoice, and neither of them clears anybody to start work.
          eq(ledgerEntries.entryType, "payment_received"),
          gt(ledgerEntries.amountCents, 0),
          // A gate is a *real* event, so a payment that was reversed must stop
          // being one. Without this, a Plaid match against the wrong job keeps
          // telling a contractor he is safe to start on it after the mistake
          // has been corrected.
          sql`not exists (
            select 1 from ledger_entries r
            where r.reverses_id = ${ledgerEntries.id}
          )`,
          // A finished job has no gate left to open.
          ne(jobs.status, "complete"),
          ne(jobs.status, "paid"),
          gte(ledgerEntries.occurredAt, cutoff),
          or(
            eq(invoiceDetails.invoiceType, "deposit"),
            eq(invoiceDetails.invoiceType, "draw")
          )!
        )
      )
      .orderBy(desc(ledgerEntries.occurredAt))
      .limit(limit),

    db
      .select({
        jobId: jobs.id,
        customerName: customers.name,
        jurisdiction: permits.jurisdiction,
        number: permits.number,
        issuedOn: permits.issuedOn,
      })
      .from(permits)
      .innerJoin(jobs, eq(permits.jobId, jobs.id))
      .innerJoin(customers, eq(jobs.customerId, customers.id))
      .where(
        and(
          eq(jobs.organizationId, organizationId),
          eq(jobs.isDemo, false),
          eq(permits.status, "issued"),
          ne(jobs.status, "complete"),
          ne(jobs.status, "paid"),
          isNotNull(permits.issuedOn),
          gte(permits.issuedOn, since)
        )
      )
      .orderBy(desc(permits.issuedOn))
      .limit(limit),
  ]);

  const all: Gate[] = [
    ...paid.map((row): Gate => {
      const deposit = row.invoiceType === "deposit";
      const name = surname(row.customerName);
      // `occurredAt` — when the money moved in the world — rather than
      // `recordedAt`. A cheque deposited on Friday and entered on Monday
      // cleared the contractor to start on Friday.
      const on = row.occurredAt.toISOString().slice(0, 10);
      return {
        jobId: row.jobId,
        kind: deposit ? "deposit" : "draw",
        customerName: row.customerName,
        sentence: deposit
          ? `Deposit cleared ${when(on)} — **${name}** is safe to start.`
          : `Draw paid ${when(on)} — **${name}** can keep moving.`,
        short: deposit
          ? "Deposit cleared — safe to start"
          : "Draw paid — the next phase can begin",
        detail: `${money(row.amountCents)} in · ${when(on)}`,
        at: on,
      };
    }),
    ...issued.map((row): Gate => ({
      jobId: row.jobId,
      kind: "permit",
      customerName: row.customerName,
      sentence: `Permit issued — **${surname(row.customerName)}** is cleared to start.`,
      short: "Permit issued — cleared to start",
      detail: [row.jurisdiction, row.number].filter(Boolean).join(" · "),
      at: row.issuedOn!,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const byJob = new Map<string, Gate>();
  for (const gate of all) {
    if (!byJob.has(gate.jobId)) byJob.set(gate.jobId, gate);
  }
  return byJob;
}

/* ── Wording ──────────────────────────────────────────────────────────── */

/** The name a contractor uses out loud — "Henderson", not "Tom Henderson". */
export function surname(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : name;
}

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** "Friday", "5 days ago", or a date once it stops being conversational. */
export function when(value: Date | string) {
  const date = typeof value === "string" ? new Date(`${value}T12:00:00Z`) : value;
  const days = Math.round((Date.now() - date.getTime()) / 86_400_000);

  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return date.toLocaleDateString("en-US", { weekday: "long" });
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
