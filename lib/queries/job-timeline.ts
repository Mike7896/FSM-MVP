import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  changeOrderDetails,
  contractDetails,
  customers,
  documents,
  invoiceDetails,
  jobs,
  ledgerEntries,
} from "@/lib/db/schema";
import { documentActivity } from "@/lib/queries/document-activity";
import { jobMoney } from "@/lib/queries/jobs";
import { formatMoney } from "@/lib/quote";
import { certificateFor } from "@/lib/signing/certificate";

/**
 * EVERYTHING THAT HAS HAPPENED ON A JOB, oldest first — the quote, the
 * contract, every change order, every bill and every payment — and what's
 * still to come.
 *
 * Each step is read from the record that proves it: a document's own
 * timestamps, its send log and link visits, the signatures on it, the ledger.
 * Nothing here is a status somebody set, so the story can't say something the
 * records don't.
 */

export type JobEvent = {
  /** When it happened. Null for a step still to come. */
  at: Date | null;
  label: string;
  detail?: string;
};

const MONEY_EVENTS = [
  "payment_received",
  "refund_issued",
  "chargeback_opened",
  "chargeback_reversed",
] as const;

const BILL_NAMES: Record<string, string> = {
  deposit: "Deposit",
  draw: "Progress",
  final_balance: "Final",
};

export async function jobTimeline(
  jobId: string,
  organizationId: string
): Promise<JobEvent[]> {
  const [job] = await db
    .select({ customerName: customers.name })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);
  if (!job) return [];

  const who = job.customerName.trim().split(/\s+/)[0] || "The customer";

  const [docs, money, moneyByJob] = await Promise.all([
    db
      .select({
        id: documents.id,
        type: documents.type,
        number: documents.number,
        status: documents.status,
        createdAt: documents.createdAt,
        issuedAt: documents.issuedAt,
        acceptedAt: contractDetails.acceptedAt,
        approvedAt: changeOrderDetails.approvedAt,
        invoiceType: invoiceDetails.invoiceType,
        amountDueCents: invoiceDetails.amountDueCents,
        voidedAt: invoiceDetails.voidedAt,
      })
      .from(documents)
      .leftJoin(contractDetails, eq(contractDetails.documentId, documents.id))
      .leftJoin(changeOrderDetails, eq(changeOrderDetails.documentId, documents.id))
      .leftJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
      .where(
        and(
          eq(documents.jobId, jobId),
          eq(documents.organizationId, organizationId)
        )
      )
      .orderBy(asc(documents.createdAt)),
    db
      .select({
        entryType: ledgerEntries.entryType,
        amountCents: ledgerEntries.amountCents,
        method: ledgerEntries.method,
        occurredAt: ledgerEntries.occurredAt,
        invoiceId: ledgerEntries.invoiceId,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.jobId, jobId),
          eq(ledgerEntries.organizationId, organizationId),
          inArray(ledgerEntries.entryType, [...MONEY_EVENTS])
        )
      )
      .orderBy(asc(ledgerEntries.occurredAt)),
    jobMoney([jobId]),
  ]);

  const [activity, certificates] = await Promise.all([
    Promise.all(docs.map((doc) => documentActivity(doc.id))),
    Promise.all(
      docs.map((doc) =>
        doc.type === "contract" || doc.type === "change_order"
          ? certificateFor(doc.id, organizationId)
          : Promise.resolve(null)
      )
    ),
  ]);

  const done: JobEvent[] = [];
  const numbers = new Map(docs.map((doc) => [doc.id, doc.number]));

  docs.forEach((doc, index) => {
    const name = documentName(doc);
    const { sends, visits } = activity[index];

    if (doc.type === "quote") {
      done.push({ at: doc.createdAt, label: `You started ${name}` });
    } else if (doc.type === "contract") {
      done.push({
        at: doc.createdAt,
        label: `${capitalize(name)} drawn up`,
        detail: "From the accepted quote",
      });
    } else if (doc.type === "change_order") {
      done.push({ at: doc.createdAt, label: `You wrote ${name}` });
    } else if (doc.type === "invoice" && doc.issuedAt) {
      done.push({
        at: doc.issuedAt,
        label: `${capitalize(name)} issued`,
        detail: doc.amountDueCents !== null ? formatMoney(doc.amountDueCents) : undefined,
      });
    }

    for (const send of sends) {
      done.push({
        at: send.sentAt,
        label:
          send.channel === "email"
            ? `${capitalize(name)} emailed to ${send.recipient ?? who}`
            : send.channel === "text"
              ? `${capitalize(name)} texted to ${send.recipient ?? who}`
              : `You copied the link to ${name}`,
      });
    }
    for (const visit of visits) {
      done.push({ at: visit, label: `${who} opened ${name}` });
    }

    if (doc.type === "contract" && doc.acceptedAt) {
      // The acceptance is what draws the contract up, so it goes first even
      // when its row was written a few milliseconds after the contract's.
      const at = new Date(
        Math.min(doc.acceptedAt.getTime(), doc.createdAt.getTime() - 1)
      );
      done.push({ at, label: `${who} accepted the quote` });
    }

    for (const signature of certificates[index]?.signatures ?? []) {
      done.push({
        at: signature.signedAt,
        label:
          signature.party === "contractor"
            ? `You signed ${name}`
            : `${who} signed ${name}`,
      });
    }

    if (doc.type === "change_order" && doc.approvedAt) {
      done.push({ at: doc.approvedAt, label: `${who} approved ${name}` });
    }
    if (doc.type === "invoice" && doc.voidedAt) {
      done.push({ at: doc.voidedAt, label: `${capitalize(name)} voided` });
    }
  });

  for (const entry of money) {
    const bill = entry.invoiceId ? numbers.get(entry.invoiceId) : undefined;
    const amount = formatMoney(Math.abs(entry.amountCents));
    const method = entry.method ? ` by ${methodWord(entry.method)}` : "";
    done.push({
      at: entry.occurredAt,
      label:
        entry.entryType === "payment_received"
          ? `${who} paid ${amount}${method}`
          : entry.entryType === "refund_issued"
            ? `Refunded ${amount} to ${who}`
            : entry.entryType === "chargeback_opened"
              ? `${who}'s bank disputed ${amount}`
              : `Dispute over ${amount} resolved in your favour`,
      detail: bill ? `Invoice ${bill}` : undefined,
    });
  }

  // Paid in full: the moment the last of what was agreed arrived.
  const totals = moneyByJob.get(jobId);
  const paidInFull =
    totals !== undefined &&
    totals.totalCents > 0 &&
    totals.collectedCents >= totals.totalCents;
  const lastPayment = [...money]
    .reverse()
    .find((entry) => entry.entryType === "payment_received");
  if (paidInFull && lastPayment) {
    done.push({
      at: lastPayment.occurredAt,
      label: "Paid in full",
      detail: formatMoney(totals.totalCents),
    });
  }

  done.sort((a, b) => a.at!.getTime() - b.at!.getTime());

  return [...done, ...ahead({ docs, certificates, totals, paidInFull, who })];
}

/** The steps still to come, in the order they'll happen. */
function ahead({
  docs,
  certificates,
  totals,
  paidInFull,
  who,
}: {
  docs: { type: string; status: string; invoiceType: string | null; voidedAt: Date | null }[];
  certificates: ({ signatures: { party: string }[] } | null)[];
  totals: { totalCents: number; collectedCents: number } | undefined;
  paidInFull: boolean;
  who: string;
}): JobEvent[] {
  if (paidInFull) return [];

  const steps: JobEvent[] = [];
  const contractIndex = docs.findIndex((doc) => doc.type === "contract");

  if (contractIndex === -1) {
    steps.push({ at: null, label: `${who} accepts the quote` });
  } else {
    const signed = certificates[contractIndex]?.signatures ?? [];
    if (!signed.some((entry) => entry.party === "contractor")) {
      steps.push({ at: null, label: "You sign the contract" });
    }
    if (!signed.some((entry) => entry.party === "customer")) {
      steps.push({ at: null, label: `${who} signs the contract` });
    }
  }

  const finalBill = docs.some(
    (doc) =>
      doc.type === "invoice" &&
      doc.invoiceType === "final_balance" &&
      doc.voidedAt === null
  );
  if (!finalBill) steps.push({ at: null, label: "The final invoice" });

  steps.push({
    at: null,
    label: "Paid in full",
    detail:
      totals && totals.totalCents > 0
        ? `${formatMoney(totals.totalCents - totals.collectedCents)} to go`
        : undefined,
  });

  return steps;
}

/** "the quote", "contract C-0001", "the final invoice INV-0001". */
function documentName(doc: {
  type: string;
  number: string;
  invoiceType: string | null;
}): string {
  switch (doc.type) {
    case "quote":
      return `quote ${doc.number}`;
    case "contract":
      return `contract ${doc.number}`;
    case "change_order":
      return `change order ${doc.number}`;
    default: {
      const kind = doc.invoiceType ? BILL_NAMES[doc.invoiceType] : null;
      return kind
        ? `${kind.toLowerCase()} invoice ${doc.number}`
        : `invoice ${doc.number}`;
    }
  }
}

function methodWord(method: string): string {
  return method === "ach" ? "bank transfer" : method.replace(/_/g, " ");
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
