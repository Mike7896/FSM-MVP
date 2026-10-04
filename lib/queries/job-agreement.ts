import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { customers, documents } from "@/lib/db/schema";
import { loadDocument, readQuoteRecord } from "@/lib/documents";
import { contractDraft } from "@/lib/queries/contracts";
import {
  draftFromRecord,
  paymentPlan,
  totals,
  type PlannedPayment,
  type QuoteDraft,
  type QuoteTotals,
} from "@/lib/quote";

/**
 * What a job's money is built on: the signed-for contract once there is one,
 * and until then the quote that's out with the customer.
 *
 * **One read for the scope, the price and the plan**, so the money page can
 * show what each room costs beside the phases being planned against it, and
 * the job hub can show the deposit and phases a sent quote proposes while
 * nothing is agreed yet — instead of "nothing planned" over a quote that
 * plainly asks for a deposit.
 */
export type JobAgreement = {
  kind: "contract" | "quote";
  documentId: string;
  /** `C-0002`, `Q-0003`. */
  number: string;
  status: string;
  /** The quote's id — the contract's source, or the quote itself. Where the plan is changed. */
  quoteId: string | null;
  draft: QuoteDraft;
  sums: QuoteTotals;
  plan: PlannedPayment[];
};

/** Quote statuses still waiting on an answer — what "the job's quote" means before acceptance. */
const OPEN_QUOTE = ["draft", "sent", "viewed"] as const;

export async function getJobAgreement(
  jobId: string,
  organizationId: string
): Promise<JobAgreement | null> {
  const [contract] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.jobId, jobId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "contract")
      )
    )
    .orderBy(desc(documents.createdAt))
    .limit(1);

  if (contract) {
    const document = await loadDocument(contract.id, organizationId);
    if (document?.type === "contract") {
      const [source, [customer]] = await Promise.all([
        document.sourceDocumentId
          ? loadDocument(document.sourceDocumentId, organizationId)
          : Promise.resolve(null),
        document.customerId
          ? db
              .select({ id: customers.id, name: customers.name })
              .from(customers)
              .where(eq(customers.id, document.customerId))
              .limit(1)
          : Promise.resolve([]),
      ]);
      return agreement({
        kind: "contract",
        documentId: document.id,
        number: document.number,
        status: document.status,
        quoteId: source?.type === "quote" ? source.id : null,
        draft: contractDraft(document, source, customer ?? null),
      });
    }
  }

  const [quote] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.jobId, jobId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "quote"),
        inArray(documents.status, [...OPEN_QUOTE])
      )
    )
    .orderBy(desc(documents.createdAt))
    .limit(1);

  if (!quote) return null;
  const record = await readQuoteRecord(quote.id, organizationId);
  if (!record) return null;

  return agreement({
    kind: "quote",
    documentId: record.id,
    number: record.number,
    status: record.status,
    quoteId: record.id,
    draft: draftFromRecord(record),
  });
}

function agreement(
  base: Omit<JobAgreement, "sums" | "plan">
): JobAgreement {
  const sums = totals(base.draft);
  return { ...base, sums, plan: paymentPlan(base.draft, sums) };
}
