import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  documents,
  officeDefaults,
  quoteDetails,
} from "@/lib/db/schema";
import {
  acceptQuote,
  ensureShareLink,
  issueDepositInvoice,
} from "@/lib/documents";
import { DomainError } from "@/lib/errors";
import type { SignFromLinkInput } from "@/lib/schemas";
import { SigningError, signDocument } from "@/lib/signing";
import { signsOnQuote } from "@/lib/signing/lines";

import { heldLink } from "./link";

/**
 * The customer accepts the quote by signing it — Flow 2, in one step.
 *
 * Quote Document Structure §3.5: Acceptance is both signatures, the
 * customer's captured *at* acceptance. So when a quote carries signature
 * lines, signing its customer line is the approval: the quote is accepted, its
 * contract generated with the business's stored signature, and her signature
 * recorded on that contract — **one transaction**. A signature that failed
 * leaves the quote unaccepted rather than half-agreed, and a contract never
 * exists that she approved but did not sign.
 *
 * **Her signature is recorded against the contract, not the quote.** The
 * contract is the agreement, and its hash is what the signature associates
 * with. It carries exactly the scope, price and terms she was looking at — it
 * is generated from this quote in the same instant — so she signed what she
 * read.
 *
 * **The business still signs first.** This only runs when the Office's
 * signature will be applied as the contract is generated; without it, the
 * page offers the button instead and she signs the contract once the business
 * has (`signsOnQuote`).
 *
 * Then, as with signing a contract, the completed agreement issues the
 * deposit, and that is where she goes next.
 */
export async function signQuoteFromLink(
  token: string,
  input: SignFromLinkInput,
  request: { ip: string | null; userAgent: string | null }
): Promise<{ status: string; next: string | null }> {
  const link = await heldLink(token, "quote", "accept");
  const business = link.businessName ?? "the business";

  const agreed = await db.transaction(async (tx) => {
    // Locked for the whole act, so a second tap waits for the first and then
    // finds the contract it made rather than generating another.
    const [quote] = await tx
      .select({
        status: documents.status,
        customerId: documents.customerId,
        validUntil: quoteDetails.validUntil,
        signatureLines: quoteDetails.signatureLines,
      })
      .from(documents)
      .leftJoin(quoteDetails, eq(quoteDetails.documentId, documents.id))
      .where(eq(documents.id, link.documentId))
      .limit(1)
      .for("update", { of: documents });

    if (quote?.status === "accepted") {
      const [contract] = await tx
        .select({ id: documents.id, jobId: documents.jobId, status: documents.status })
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
        const { url } = await ensureShareLink(contract, ["view", "sign"], tx);
        return { id: contract.id, status: contract.status, url };
      }
    }

    if (!quote || (quote.status !== "sent" && quote.status !== "viewed")) {
      throw new DomainError(
        `This quote can't be accepted any more. Ask ${business} for an updated one.`,
        "conflict"
      );
    }

    if (
      quote.validUntil &&
      quote.validUntil < new Date().toISOString().slice(0, 10)
    ) {
      throw new DomainError(
        `This price has lapsed. Ask ${business} for an updated quote.`,
        "conflict"
      );
    }

    const [stored] = await tx
      .select({
        printedName: officeDefaults.signatureName,
        mark: officeDefaults.signatureMark,
        autoSign: officeDefaults.autoSignContracts,
      })
      .from(officeDefaults)
      .where(eq(officeDefaults.organizationId, link.organizationId))
      .limit(1);

    const office =
      stored?.printedName && stored.mark
        ? { printedName: stored.printedName, mark: stored.mark, autoSign: stored.autoSign }
        : null;

    if (!signsOnQuote({ signatureLines: quote.signatureLines ?? true }, office)) {
      throw new DomainError(
        `${business} hasn't signed this quote yet, so it's approved with the button — you'll sign the contract once they have.`,
        "conflict"
      );
    }

    const contract = await acceptQuote(link.documentId, link.organizationId, {
      acceptedBy: null,
      signNow: true,
      on: tx,
    });

    const [customer] = quote.customerId
      ? await tx
          .select({ email: customers.email })
          .from(customers)
          .where(eq(customers.id, quote.customerId))
          .limit(1)
      : [];

    let status: string;
    try {
      const { document } = await signDocument({
        documentId: contract.id,
        organizationId: link.organizationId,
        party: "customer",
        printedName: input.printedName,
        mark: input.mark,
        consented: input.consented,
        authMethod: "share_link",
        signerEmail: customer?.email ?? null,
        ip: request.ip,
        userAgent: request.userAgent,
        on: tx,
      });
      status = document.status;
    } catch (error) {
      if (error instanceof SigningError) {
        throw new DomainError(
          error.message,
          error.recoverable ? "invalid" : "conflict"
        );
      }
      throw error;
    }

    const { url } = await ensureShareLink(
      { id: contract.id, jobId: contract.jobId },
      ["view", "sign"],
      tx
    );

    return { id: contract.id, status, url };
  });

  if (agreed.status !== "signed") return { status: agreed.status, next: agreed.url };

  // Kept apart from the signature's fate, as on the contract: if the deposit
  // fails to issue, the agreement stands and the contract's page issues it the
  // next time it opens — so that is where she goes.
  try {
    const deposit = await issueDepositInvoice({
      organizationId: link.organizationId,
      contractId: agreed.id,
    });
    return { status: agreed.status, next: deposit?.url ?? agreed.url };
  } catch (error) {
    console.error("[share] signed, but the deposit didn't issue:", error);
    return { status: agreed.status, next: agreed.url };
  }
}
