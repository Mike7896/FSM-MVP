import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  contractDetails,
  documentSignatures,
  documents,
  officeDefaults,
  scopeNodes,
} from "@/lib/db/schema";
import { planFromTerms, seedJobSchedule } from "@/lib/billing";
import { notifyLater } from "@/lib/notifications";
import { documentHash } from "@/lib/signing/hash";
import { parseMark } from "@/lib/signing/mark";

import { DocumentError } from "../errors";
import { loadDocument, type Executor } from "../repository";
import { scopeTotals } from "../scope";
import type { ContractDocument } from "../types";

/**
 * `acceptQuote` — Documents §8, operation 1.
 *
 * **Acceptance generates the Contract.** There is no ambiguity between unsigned
 * and nonexistent: the Contract is a real record the moment the Quote is
 * accepted, and it is mutable until both signatures are present and immutable
 * from that point forward. Everything after it moves through a Change order,
 * which is what makes that object load-bearing rather than a convenience.
 *
 * Four writes, one transaction:
 *
 * 1. A `contract` document, sourced from the quote.
 * 2. `contract_details`, with the terms **carried forward** rather than left to
 *    be joined back — once accepted, the Contract is the agreed document, and
 *    reading a deposit percentage out of a superseded quote is how an amended
 *    term silently changes what someone signed.
 * 3. **Copied** scope nodes, each carrying `copiedFromNodeId`. Not shared: the
 *    Contract carries the full agreed scope rather than a summary, so it cannot
 *    read its scope out of a document it superseded — and a Contract with no
 *    Quote behind it is legal, which under a shared-node model would leave it
 *    with no rows at all.
 * 4. The contractor's stored signature, unless the shop has deferred it.
 *
 * Then the Quote freezes, which the database does on its own the moment the
 * status reaches `accepted`.
 */


export async function acceptQuote(
  quoteId: string,
  organizationId: string,
  options?: {
    /** Who clicked. Null when the homeowner accepted from a share link. */
    acceptedBy?: string | null;
    /** Overrides the shop's `autoSignContracts` for this one document. */
    signNow?: boolean;
    /**
     * A transaction to run inside.
     *
     * Operations chain — accepting a quote and issuing its deposit invoice is
     * one act to a contractor, and half of it committing is a job with a
     * contract nobody was billed against. Passing the caller's transaction here
     * makes the pair atomic; omitting it opens one.
     */
    on?: Executor;
  }
): Promise<ContractDocument> {
  const on: Executor = options?.on ?? db;
  const quote = await loadDocument(quoteId, organizationId, on);

  if (!quote || quote.type !== "quote") {
    throw new DocumentError("No such quote.", "not_found");
  }

  if (quote.status === "accepted") {
    throw new DocumentError(
      `${quote.number} has already been accepted. Its contract is the ` +
        `agreed document now.`
    );
  }

  if (quote.status === "declined" || quote.status === "expired") {
    throw new DocumentError(
      `${quote.number} was ${quote.status}. Send a revision rather than ` +
        `accepting it — the price and the scope may both have moved.`
    );
  }

  const [defaults] = await on
    .select({
      signatureName: officeDefaults.signatureName,
      signatureMark: officeDefaults.signatureMark,
      autoSign: officeDefaults.autoSignContracts,
    })
    .from(officeDefaults)
    .where(eq(officeDefaults.organizationId, organizationId))
    .limit(1);

  // The agreed price is computed from the quote's own rows rather than trusted
  // from a column, because the contract sum is the number the whole money card
  // subtracts from and it has to be the number the customer actually saw.
  const totals = scopeTotals(quote.scope, quote.details?.taxRate);

  // A nested `transaction` on a transaction is a savepoint, so this is correct
  // whether `on` is the pool or a caller's transaction.
  const contractId: string = await on.transaction(async (tx: Executor) => {
    const [contract] = await tx
      .insert(documents)
      .values({
        organizationId,
        jobId: quote.jobId,
        customerId: quote.customerId,
        type: "contract",
        // Number is assigned by trigger.
        number: "",
        status: "generated",
        sourceDocumentId: quote.id,
        title: quote.title,
        summary: quote.summary,
        termsText: quote.termsText,
        // The header travels with the agreement. Re-snapshotting from the
        // Office here would put June's address on a contract for a quote she
        // accepted in March.
        header: quote.header,
        packId: quote.packId,
        createdBy: options?.acceptedBy ?? null,
      })
      .returning({ id: documents.id });

    await tx.insert(contractDetails).values({
      documentId: contract.id,
      contractSumCents: totals.totalCents,
      depositCents:
        quote.details?.depositPercent != null
          ? Math.round((totals.totalCents * quote.details.depositPercent) / 100)
          : null,
      depositBasis: quote.details?.depositPercent != null ? "percent" : "none",
      contractType: quote.details?.contractType ?? null,
      billingTrigger: quote.details?.billingTrigger ?? null,
      moneyUpFront: quote.details?.moneyUpFront ?? null,
      depositPercent: quote.details?.depositPercent ?? null,
      progressBilling: quote.details?.progressBilling ?? null,
      retainagePercent: quote.details?.retainagePercent ?? null,
      licenseId: quote.details?.licenseId ?? null,
      acceptedAt: new Date(),
    });

    if (quote.scope.length > 0) {
      // Ids are minted here rather than left to the database so the parent
      // links can be rewritten in one pass. Inserting the tree level by level
      // to discover them would be one round trip per depth, and a deep scope
      // would silently get slower the more the contractor nests.
      const idFor = new Map<string, string>();
      for (const node of quote.scope) idFor.set(node.id, randomUUID());

      await tx.insert(scopeNodes).values(
        quote.scope.map((node) => ({
          id: idFor.get(node.id)!,
          organizationId,
          documentId: contract.id,
          parentNodeId: node.parentNodeId
            ? (idFor.get(node.parentNodeId) ?? null)
            : null,
          position: node.position,
          nodeType: node.nodeType,
          section: node.section,
          optional: node.optional,
          breakdown: node.breakdown,
          description: node.description,
          quantity: node.quantity,
          unit: node.unit,
          unitCostCents: node.unitCostCents,
          markupBps: node.markupBps,
          sellPriceCents: node.sellPriceCents,
          taxable: node.taxable,
          details: node.details,
          source: node.source,
          /** The lineage back to the quote node this came from. */
          copiedFromNodeId: node.id,
          // Cross-references are *not* copied. They point into a contract from
          // a change order, and a quote has none — carrying the columns across
          // would produce a contract node referencing a quote node, which is
          // exactly the shape §4 exists to prevent.
        }))
      );
    }

    // The contractor's half of the agreement, applied at generation so the
    // homeowner is never the first to sign. The insert trips
    // `contract_status_from_signatures`, which moves the contract to
    // `part_signed` — one signature is not yet an agreement, so it does not
    // freeze.
    //
    // It records what it signed, the way a signature taken by hand does: the
    // fingerprint of the contract as generated, so the signing record can show
    // the business's signature still matches the page rather than saying it
    // can't be checked.
    const sign = options?.signNow ?? defaults?.autoSign ?? true;
    if (sign && defaults?.signatureName && defaults.signatureMark) {
      const generated = await loadDocument(contract.id, organizationId, tx);
      await tx.insert(documentSignatures).values({
        documentId: contract.id,
        party: "contractor",
        printedName: defaults.signatureName,
        signatureData: defaults.signatureMark,
        signatureKind: parseMark(defaults.signatureMark).kind,
        authMethod: "account",
        documentHash: generated ? documentHash(generated) : null,
      });
    }

    // The payment plan the terms imply, written onto the job now that there is
    // an agreed price to apply the shop's percentages to (Flow 6). A plan the
    // contractor made himself stands; this only fills an empty one.
    await seedJobSchedule({
      jobId: quote.jobId,
      contractId: contract.id,
      stages: planFromTerms({
        totalCents: totals.totalCents,
        depositPercent: quote.details?.depositPercent ?? null,
        draws: quote.details?.progressBilling === "draws",
        pattern: quote.details?.drawPattern ?? null,
      }),
      on: tx,
    });

    // Last, and on its own: the quote freezes here. Nothing sets `frozen_at` —
    // `documents_freeze` stamps it because `accepted` is in the quote's frozen
    // set, which is why there is no way for this to be forgotten.
    await tx
      .update(documents)
      .set({ status: "accepted" })
      .where(
        and(eq(documents.id, quote.id), eq(documents.organizationId, organizationId))
      );

    return contract.id;
  });

  const contract = await loadDocument(contractId, organizationId, on);
  if (!contract || contract.type !== "contract") {
    throw new DocumentError(
      "The contract was written but could not be read back.",
      "failed"
    );
  }

  // Whoever clicked accept already knows; a homeowner accepting from the share
  // link is news to everyone else. If a caller's transaction rolls this back,
  // the notification re-reads the quote and says nothing.
  notifyLater({
    kind: "quote.accepted",
    organizationId,
    documentId: quote.id,
    actorUserId: options?.acceptedBy ?? null,
  });

  return contract;
}
