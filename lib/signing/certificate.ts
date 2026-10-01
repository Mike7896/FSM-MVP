import "server-only";

import { db } from "@/lib/db";
import { loadDocument, type Executor } from "@/lib/documents/repository";
import type { AnyDocument } from "@/lib/documents/types";

import { DISCLOSURE_VERSION } from "./disclosure";
import { canonical, documentHash, verifySignedHash } from "./hash";
import { parseMark } from "./mark";

/**
 * THE CERTIFICATE OF COMPLETION.
 *
 * The page a vendor's product prints at the end, rebuilt here because it is the
 * artifact that actually does the work in a dispute — the signature image is
 * decoration, and this is the evidence.
 *
 * It answers, on one page, every question an issuer or an adjuster asks:
 *
 * - What document was signed, and did it change afterwards? (the hash,
 *   recomputed live, not read back from the row)
 * - Who signed, when, from where, and how did they prove they could?
 * - Did they agree to sign electronically, and when? (ESIGN §101(c))
 * - What did the document say at that moment? (the canonical bytes, so a
 *   reviewer can recompute the digest themselves rather than trust ours)
 *
 * **The verification is recomputed at read time.** Storing "verified: true"
 * would be storing our own opinion of our own records, which is worth nothing
 * to the person reading it. Recomputing means the certificate is capable of
 * reporting that something went wrong, and a document that can only ever say
 * "fine" is not evidence.
 */

export type SignatureRecord = {
  party: "contractor" | "customer";
  printedName: string;
  /** Renderable form of the mark. */
  mark: ReturnType<typeof parseMark>;
  signedAt: Date;
  consentedAt: Date | null;
  signerEmail: string | null;
  authMethod: "account" | "share_link";
  ip: string | null;
  userAgent: string | null;
  /** Whether this signature's hash still matches the document. */
  integrity: { verified: boolean; expected: string; recorded: string | null };
};

export type Certificate = {
  document: {
    id: string;
    type: AnyDocument["type"];
    number: string;
    title: string | null;
    status: string;
    /** Non-null means the record has been immutable since this moment. */
    frozenAt: Date | null;
    businessName: string | null;
    customerName: string | null;
    jobAddress: string | null;
  };

  /** Recomputed now, from the document as it stands. */
  currentHash: string;
  /** The exact bytes hashed, so a reviewer can check our arithmetic. */
  canonicalContent: string;
  hashAlgorithm: "SHA-256";

  signatures: SignatureRecord[];

  /** True only when every signature's hash matches and the document is frozen. */
  complete: boolean;
  /** Anything a reviewer should be told plainly rather than left to spot. */
  exceptions: string[];

  disclosureVersion: string;
  generatedAt: Date;
};

export async function certificateFor(
  documentId: string,
  organizationId: string,
  on: Executor = db
): Promise<Certificate | null> {
  const document = await loadDocument(documentId, organizationId, on);
  if (!document) return null;

  const currentHash = documentHash(document);
  const exceptions: string[] = [];

  const signatures: SignatureRecord[] = document.signatures
    .slice()
    .sort((a, b) => a.signedAt.getTime() - b.signedAt.getTime())
    .map((signature) => {
      const integrity = verifySignedHash(document, signature.documentHash);

      if (!integrity.verified) {
        exceptions.push(
          integrity.recorded === null
            ? `${signature.party}'s signature predates content hashing, so the ` +
              `document cannot be verified against it automatically.`
            : `${signature.party}'s signature was taken against different ` +
              `content than the document now holds. This should be impossible ` +
              `— the record is frozen — and needs investigating before this ` +
              `certificate is relied on.`
        );
      }

      // ESIGN's consent-before-signing rule protects the consumer. The
      // business's own signature, applied from the one it adopted in the
      // Office, is its standing instruction rather than a consumer's consent.
      if (!signature.consentedAt && signature.party === "customer") {
        exceptions.push(
          `No electronic-records consent is recorded for ${signature.party}.`
        );
      }

      return {
        party: signature.party,
        printedName: signature.printedName,
        mark: parseMark(signature.signatureData),
        signedAt: signature.signedAt,
        consentedAt: signature.consentedAt,
        signerEmail: signature.signerEmail,
        authMethod: signature.authMethod,
        ip: signature.ip,
        userAgent: signature.userAgent,
        integrity,
      };
    });

  if (document.type === "contract" && signatures.length < 2) {
    exceptions.push(
      signatures.length === 0
        ? "Nobody has signed this contract."
        : "Only one party has signed. This is not yet an agreement."
    );
  }

  if (!document.frozenAt) {
    exceptions.push(
      "This document is still editable, so its content is not yet fixed."
    );
  }

  return {
    document: {
      id: document.id,
      type: document.type,
      number: document.number,
      title: document.title,
      status: document.status,
      frozenAt: document.frozenAt,
      businessName: document.header.businessName ?? null,
      customerName: document.header.customerName ?? null,
      jobAddress: document.header.jobAddress ?? null,
    },
    currentHash,
    canonicalContent: canonical(document),
    hashAlgorithm: "SHA-256",
    signatures,
    complete: exceptions.length === 0,
    exceptions,
    disclosureVersion: DISCLOSURE_VERSION,
    generatedAt: new Date(),
  };
}
