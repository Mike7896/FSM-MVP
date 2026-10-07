import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents, quoteDetails } from "@/lib/db/schema";
import { acceptQuote, ensureShareLink } from "@/lib/documents";
import { DomainError } from "@/lib/errors";

import { requireReviewedQuote } from "./review-quote";
import { heldLink } from "./link";

/**
 * The customer approves the quote from the link — Flow 2's first step.
 *
 * **Approving generates the contract** (`acceptQuote`), with the contractor's
 * stored signature already on it where the Office keeps one. The contract
 * arrives through a link of its own — one token, one document — and that is
 * where this sends them next.
 *
 * **Tapping twice is not an error.** The quote's row is locked for the whole
 * approval, so a second tap waits for the first and then finds the contract it
 * made rather than generating another.
 */
export async function approveFromLink(token: string, hash: string): Promise<{ next: string }> {
  const link = await heldLink(token, "quote", "accept");
  const business = link.businessName ?? "the business";

  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select({ status: documents.status, validUntil: quoteDetails.validUntil })
      .from(documents)
      .leftJoin(quoteDetails, eq(quoteDetails.documentId, documents.id))
      .where(eq(documents.id, link.documentId))
      .limit(1)
      .for("update", { of: documents });

    await requireReviewedQuote(link.documentId, link.organizationId, hash, tx);

    if (quote?.status === "accepted") {
      const [contract] = await tx
        .select({ id: documents.id, jobId: documents.jobId })
        .from(documents)
        .where(
          and(
            eq(documents.sourceDocumentId, link.documentId),
            eq(documents.type, "contract")
          )
        )
        .orderBy(desc(documents.createdAt))
        .limit(1);

      if (contract) {
        return {
          next: (await ensureShareLink(contract, ["view", "sign"], tx)).url,
        };
      }
    }

    if (!quote || (quote.status !== "sent" && quote.status !== "viewed")) {
      throw new DomainError(
        `This quote can't be approved any more. Ask ${business} for an updated one.`,
        "conflict"
      );
    }

    // The price holds through the day it names, and not after.
    if (
      quote.validUntil &&
      quote.validUntil < new Date().toISOString().slice(0, 10)
    ) {
      throw new DomainError(
        `This price held until ${dateOf(quote.validUntil)}. Ask ${business} for an updated quote.`,
        "conflict"
      );
    }

    const contract = await acceptQuote(link.documentId, link.organizationId, {
      acceptedBy: null,
      on: tx,
    });

    return {
      next: (
        await ensureShareLink(
          { id: contract.id, jobId: contract.jobId },
          ["view", "sign"],
          tx
        )
      ).url,
    };
  });
}

function dateOf(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
