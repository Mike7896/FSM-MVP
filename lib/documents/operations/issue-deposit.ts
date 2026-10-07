import "server-only";

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { refreshJobStatus } from "@/lib/billing";
import { db } from "@/lib/db";
import {
  contractDetails,
  documents,
  drawSchedule,
  invoiceDetails,
  jobs,
} from "@/lib/db/schema";

import { ensureShareLink } from "../share-links";
import { createInvoice } from "./create-invoice";

/**
 * `issueDepositInvoice` — the deposit ask, issued by the signature that
 * completes the contract.
 *
 * Flow 2's chain is approve → contract → sign → deposit: the customer pays
 * against a document both parties have executed, never against a quote. The
 * deposit is an Invoice of type `deposit` — the same object as each draw and the
 * final balance — sourced from the contract, for the amount the contract fixed
 * when it was generated. It gets a link of its own that lets its holder pay.
 *
 * **Idempotent, and serialized per contract.** The customer's signature, a
 * retry, the contractor countersigning and the contract page opening again all
 * call this; an advisory lock held across the look-up and the write means they
 * all end at one invoice rather than asking for the deposit twice.
 *
 * Returns null when there is nothing to ask for: the contract isn't signed by
 * both parties yet, or its terms take no deposit.
 */
export async function issueDepositInvoice({
  organizationId,
  contractId,
}: {
  organizationId: string;
  contractId: string;
}): Promise<{ invoiceId: string; url: string } | null> {
  const [contract] = await db
    .select({
      id: documents.id,
      jobId: documents.jobId,
      status: documents.status,
      title: documents.title,
      depositCents: contractDetails.depositCents,
    })
    .from(documents)
    .innerJoin(contractDetails, eq(contractDetails.documentId, documents.id))
    .where(
      and(
        eq(documents.id, contractId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "contract")
      )
    )
    .limit(1);

  if (!contract || contract.status !== "signed") return null;

  if (!contract.depositCents || contract.depositCents <= 0) {
    // Signed with nothing to collect up front. There's no bill to issue, but
    // the agreement still moves the job on from quoting.
    await refreshJobStatus(contract.jobId, organizationId);
    return null;
  }

  const issued = await db.transaction(async (tx) => {
    // Held until this transaction commits, invoice and link included, so a
    // second caller waits and then finds what the first one wrote. Everything
    // below runs on this transaction: a read sent back to the pool from inside
    // it would wait on the very connection the lock is holding.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`deposit:${contract.id}`}))`
    );

    await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, contract.jobId)).for("update");

    const [existing] = await tx
      .select({ id: documents.id })
      .from(documents)
      .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
      .where(
        and(
          eq(documents.sourceDocumentId, contract.id),
          eq(documents.type, "invoice"),
          eq(invoiceDetails.invoiceType, "deposit"),
          ne(documents.status, "void"),
          isNull(invoiceDetails.voidedAt)
        )
      )
      .orderBy(desc(documents.createdAt))
      .limit(1);

    const invoiceId =
      existing?.id ??
      (
        await createInvoice({
          organizationId,
          on: tx,
          input: {
            jobId: contract.jobId,
            type: "deposit",
            amountDueCents: contract.depositCents!,
            covers: contract.title?.trim()
              ? `Deposit to book ${contract.title.trim()}`
              : "Deposit to book the work",
            sourceContractId: contract.id,
            issue: true,
          },
        })
      ).id;

    // The deposit *becomes* the plan's first stage, so the job hub shows one
    // row rather than a plan and a bill saying the same thing.
    await tx
      .update(drawSchedule)
      .set({ invoiceId, updatedAt: new Date() })
      .where(
        and(
          eq(drawSchedule.jobId, contract.jobId),
          eq(drawSchedule.gate, "on_acceptance"),
          isNull(drawSchedule.invoiceId)
        )
      );

    const { url } = await ensureShareLink(
      { id: invoiceId, jobId: contract.jobId },
      ["view", "pay"],
      tx
    );

    return { invoiceId, url };
  });

  // Signed, and the first bill is out: the job is under way.
  await refreshJobStatus(contract.jobId, organizationId);

  return issued;
}
