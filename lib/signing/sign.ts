import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { documentSignatures } from "@/lib/db/schema";
import { loadDocument, type Executor } from "@/lib/documents/repository";
import type { DocumentSignature } from "@/lib/db/schema";
import type { AnyDocument } from "@/lib/documents/types";

import { documentHash } from "./hash";
import { drawnMark, MarkError, typedMark } from "./mark";

/**
 * SIGNING — Documents §6. **Built in-house. No third-party e-signature.**
 *
 * There is no envelope round-trip and no webhook, and the signed artifact lives
 * in our own database rather than on a vendor's system. That is a deliberate
 * trade: a vendor gives you a certificate and a brand, and charges per envelope
 * for a feature that is, mechanically, an append-only row plus a hash.
 *
 * What it does *not* let us skip is the reason a vendor's signature holds up.
 * Four things make an electronic signature evidence rather than an image:
 *
 * 1. **Intent** — the act itself, recorded as its own row.
 * 2. **Consent** to transact electronically, recorded separately, because
 *    "they signed, therefore they consented" is the reasoning an issuer
 *    discounts (ESIGN §101(c) — see `disclosure.ts`).
 * 3. **Association** with the record — the SHA-256 of what was on the page.
 * 4. **Attribution** — IP, user agent, the address it was sent to, and how the
 *    signer proved they were entitled to sign.
 *
 * Every one of those is captured **server-side**. A client that reported its
 * own IP or its own signing time would be a client that can forge the audit
 * trail, which is the only part of this that matters.
 */

export class SigningError extends Error {
  constructor(
    message: string,
    /** True when the caller could succeed by changing something. */
    readonly recoverable = true
  ) {
    super(message);
    this.name = "SigningError";
  }
}

export type SignInput = {
  documentId: string;
  organizationId: string;
  party: "contractor" | "customer";

  /** What they typed as their name, printed beneath the mark. */
  printedName: string;
  /** Either a typed name or the drawn strokes. Never both. */
  mark: { kind: "typed" } | { kind: "drawn"; paths: string[] };

  /** They ticked the box. Without this there is no signature. */
  consented: boolean;

  /** How they got here. */
  authMethod: "account" | "share_link";
  signerEmail?: string | null;

  /**
   * Captured from the request by the route, never sent by the client.
   *
   * A browser can claim any address and any time it likes; an audit trail
   * assembled from claims is not one.
   */
  ip?: string | null;
  userAgent?: string | null;

  on?: Executor;
};

/**
 * The parties that may sign each type, and in what state.
 *
 * A quote is *accepted*, not signed — acceptance generates the Contract, and
 * that is the document that carries signatures. An invoice is never signed at
 * all: it is a bill, and asking a homeowner to sign one implies a negotiation
 * that already happened.
 */
const SIGNABLE: Record<string, { statuses: string[]; parties: string[] }> = {
  contract: {
    statuses: ["generated", "part_signed"],
    parties: ["contractor", "customer"],
  },
  change_order: {
    // A change order's approval *is* its signature, which is why §6 says the
    // same mechanism serves both rather than inventing a second one.
    statuses: ["draft", "sent"],
    parties: ["contractor", "customer"],
  },
};

/**
 * Records one signature.
 *
 * Returns the signature and the document as it stands afterwards, because the
 * caller almost always needs to know whether that was the *last* one — the
 * second signature on a contract moves it to `signed` and freezes it, from a
 * database trigger, and the page has to reflect that immediately.
 */
export async function signDocument(
  input: SignInput
): Promise<{ signature: DocumentSignature; document: AnyDocument }> {
  const on: Executor = input.on ?? db;

  if (!input.consented) {
    throw new SigningError(
      "Agree to sign electronically before signing. You can ask for a paper " +
        "copy instead at any time."
    );
  }

  const printedName = input.printedName.trim();
  if (!printedName) {
    throw new SigningError("Type your name so we know who signed.");
  }

  const document = await loadDocument(input.documentId, input.organizationId, on);
  if (!document) {
    throw new SigningError("No such document.", false);
  }

  const rule = SIGNABLE[document.type];
  if (!rule) {
    throw new SigningError(
      document.type === "quote"
        ? "A quote is accepted rather than signed — accepting it produces the " +
          "contract, and that is what gets signed."
        : "An invoice is a bill, not an agreement. There is nothing to sign.",
      false
    );
  }

  if (!rule.parties.includes(input.party)) {
    throw new SigningError(`A ${document.type} is not signed by that party.`, false);
  }

  if (!rule.statuses.includes(document.status)) {
    throw new SigningError(
      document.frozenAt
        ? `${document.number} is already complete. Changing it now takes a ` +
          `change order, not another signature.`
        : `${document.number} is ${document.status} and cannot be signed yet.`,
      false
    );
  }

  if (document.signatures.some((s) => s.party === input.party)) {
    throw new SigningError(
      `${document.number} already carries a ${input.party} signature. ` +
        `Re-signing is a new document, not a second mark on this one.`,
      false
    );
  }

  let signatureData: string;
  let signatureKind: "typed" | "drawn";
  try {
    if (input.mark.kind === "drawn") {
      signatureData = drawnMark(input.mark.paths);
      signatureKind = "drawn";
    } else {
      signatureData = typedMark(printedName);
      signatureKind = "typed";
    }
  } catch (error) {
    throw error instanceof MarkError
      ? new SigningError(error.message)
      : error;
  }

  const now = new Date();

  const [signature] = await on
    .insert(documentSignatures)
    .values({
      documentId: document.id,
      party: input.party,
      printedName,
      signatureData,
      signatureKind,
      signedAt: now,
      // Recorded as its own fact. In this flow the two happen together, and
      // the column exists so that a future flow where consent is collected
      // once per customer does not have to lie about when it happened.
      consentedAt: now,
      documentHash: documentHash(document),
      signerEmail: input.signerEmail ?? null,
      authMethod: input.authMethod,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })
    .returning();

  // Read back rather than patching the in-memory copy: the insert may have
  // tripped `contract_status_from_signatures`, which moves the document to
  // `signed` and freezes it, and the caller needs the real state rather than
  // our guess at it.
  const after = await loadDocument(document.id, input.organizationId, on);

  return { signature, document: after ?? document };
}

/**
 * Who still has to sign, in the order the product asks them.
 *
 * The contractor first — his signature is applied at generation, so the
 * homeowner is never the first to commit to a document nobody stands behind.
 */
export function outstandingSignatures(document: AnyDocument): {
  party: "contractor" | "customer";
  signed: boolean;
  at: Date | null;
}[] {
  const rule = SIGNABLE[document.type];
  if (!rule) return [];

  return (rule.parties as ("contractor" | "customer")[]).map((party) => {
    const signature = document.signatures.find((s) => s.party === party);
    return {
      party,
      signed: signature !== undefined,
      at: signature?.signedAt ?? null,
    };
  });
}

/** Whether this party may sign right now. Drives the button's disabled state. */
export function canSign(
  document: AnyDocument,
  party: "contractor" | "customer"
): boolean {
  const rule = SIGNABLE[document.type];
  return (
    rule !== undefined &&
    rule.parties.includes(party) &&
    rule.statuses.includes(document.status) &&
    document.frozenAt === null &&
    !document.signatures.some((s) => s.party === party)
  );
}

/** The signature this party left, if they have. */
export async function signaturesFor(
  documentId: string,
  on: Executor = db
): Promise<DocumentSignature[]> {
  return on
    .select()
    .from(documentSignatures)
    .where(and(eq(documentSignatures.documentId, documentId)));
}
