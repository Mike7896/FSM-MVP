import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { documentSignatures, documents } from "@/lib/db/schema";
import {
  appliedSignature,
  type DocumentSignatures,
  type LineSignature,
  type OfficeSignature,
} from "@/lib/signing/lines";

/**
 * Who has signed a quote's lines.
 *
 * **The signatures live on the contract, not the quote.** Accepting a quote
 * generates its contract, and that is the record the signatures are made
 * against — the hash in each one is of the agreed document. So once a quote is
 * accepted its lines are read from the contract it became; before that, the
 * business's line shows the stored signature the Office will apply, and hers
 * is empty.
 */
export async function quoteSignatures(
  quoteId: string,
  organizationId: string,
  office: OfficeSignature | null
): Promise<DocumentSignatures> {
  const [contract] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.sourceDocumentId, quoteId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "contract")
      )
    )
    .orderBy(desc(documents.createdAt))
    .limit(1);

  if (!contract) {
    return { contractor: appliedSignature(office), customer: null };
  }

  return contractSignatures(contract.id);
}

/** The signatures recorded on one document, by party. */
export async function contractSignatures(
  documentId: string
): Promise<DocumentSignatures> {
  const rows = await db
    .select({
      party: documentSignatures.party,
      printedName: documentSignatures.printedName,
      mark: documentSignatures.signatureData,
      signedAt: documentSignatures.signedAt,
    })
    .from(documentSignatures)
    .where(eq(documentSignatures.documentId, documentId));

  const of = (party: "contractor" | "customer"): LineSignature | null => {
    const row = rows.find((signature) => signature.party === party);
    return row
      ? { mark: row.mark, printedName: row.printedName, signedAt: row.signedAt }
      : null;
  };

  return { contractor: of("contractor"), customer: of("customer") };
}
