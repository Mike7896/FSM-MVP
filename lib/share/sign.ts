import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { issueDepositInvoice, loadDocument } from "@/lib/documents";
import { DomainError } from "@/lib/errors";
import type { SignFromLinkInput } from "@/lib/schemas";
import { SigningError, signDocument } from "@/lib/signing";

import { DEAD_LINK, heldLink } from "./link";
import { reportError } from "@/lib/observability";

/**
 * The customer signs the contract from the link — Flow 2's second step.
 *
 * **The business signs first.** Its stored signature is applied when the quote
 * is approved, and a customer is never the first to commit to a document nobody
 * stands behind — so a contract still waiting on the business says so rather
 * than taking a signature.
 *
 * **The signature that completes the contract issues the deposit**, and that is
 * where they go next. Issuing is kept apart from the signature's fate: if it
 * fails, the signature stands — the yes is the hard part — and the contract page
 * issues the deposit the next time it opens.
 */
export async function signFromLink(
  token: string,
  input: SignFromLinkInput,
  request: { ip: string | null; userAgent: string | null }
): Promise<{ status: string; next: string | null }> {
  const link = await heldLink(token, "contract", "sign");

  const contract = await loadDocument(link.documentId, link.organizationId);
  if (!contract || contract.type !== "contract") {
    throw new DomainError(DEAD_LINK, "not_found");
  }

  if (!contract.signatures.some((signature) => signature.party === "contractor")) {
    throw new DomainError(
      `${link.businessName ?? "The business"} hasn't signed this yet. You can sign as soon as they have.`,
      "conflict"
    );
  }

  const [customer] = contract.customerId
    ? await db
        .select({ email: customers.email })
        .from(customers)
        .where(eq(customers.id, contract.customerId))
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

  if (status !== "signed") return { status, next: null };

  try {
    const deposit = await issueDepositInvoice({
      organizationId: link.organizationId,
      contractId: contract.id,
    });
    return { status, next: deposit?.url ?? null };
  } catch (error) {
    reportError("[share] signed, but the deposit didn't issue:", error);
    return { status, next: null };
  }
}
