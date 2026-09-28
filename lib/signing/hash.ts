import { createHash } from "node:crypto";

import type { AnyDocument } from "@/lib/documents/types";

/**
 * THE DOCUMENT HASH — what logically associates a signature with a record.
 *
 * ESIGN and UETA both require the signature to be "attached to or logically
 * associated with" the record. A foreign key says *these rows are related*; a
 * hash says **the thing I signed said exactly this**, and only the second one
 * survives someone asking whether the document changed afterwards.
 *
 * The freeze already makes that impossible, so in practice a recomputed hash
 * will always match. That is the point: the packet can *demonstrate* the
 * document is unchanged rather than asking an issuer to take our triggers on
 * faith.
 *
 * ## What is hashed, and what is deliberately not
 *
 * Everything the signer could read: the header they saw, the title, the terms,
 * the priced scope in document order, and the money on the side table. **Not**
 * the row ids, timestamps, or anything the system generates after the fact —
 * hashing `updated_at` would make the hash change when nothing the signer cared
 * about did, and a hash that drifts proves nothing.
 *
 * Ordering is fixed explicitly rather than left to `JSON.stringify` key order,
 * because that order follows insertion and a refactor of the loader would
 * silently invalidate every signature ever taken.
 */

export function documentHash(document: AnyDocument): string {
  return createHash("sha256").update(canonical(document)).digest("hex");
}

/**
 * The exact bytes that get hashed.
 *
 * Exported so a dispute packet can show its working — "here is what we hashed,
 * here is the digest, recompute it yourself" is a much stronger exhibit than a
 * bare hex string.
 */
export function canonical(document: AnyDocument): string {
  const header = document.header ?? {};

  const parts: unknown[] = [
    // Identity of the record, as the signer would name it.
    ["type", document.type],
    ["number", document.number],
    ["title", document.title ?? ""],
    ["summary", document.summary ?? ""],
    ["terms", document.termsText ?? ""],

    // The letterhead they read.
    [
      "header",
      [
        header.businessName ?? "",
        header.businessAddress ?? "",
        header.businessPhone ?? "",
        header.licenseNumber ?? "",
        header.customerName ?? "",
        header.customerAddress ?? "",
        header.jobAddress ?? "",
      ],
    ],

    // Every scope row, in document order, with only the fields on the page.
    // Cost and markup are excluded: the homeowner never saw them, so they are
    // not part of what she agreed to, and including them would let an internal
    // margin correction invalidate her signature.
    [
      "scope",
      [...document.scope]
        .sort((a, b) => a.position - b.position)
        .map((node) => [
          node.position,
          node.nodeType,
          node.section ?? "",
          node.optional ? 1 : 0,
          node.description,
          node.quantity,
          node.unit ?? "",
          node.sellPriceCents,
          node.taxable ? 1 : 0,
        ]),
    ],

    ["money", moneyOf(document)],
  ];

  return JSON.stringify(parts);
}

/** The per-type numbers that appear on the face of the document. */
function moneyOf(document: AnyDocument): unknown {
  switch (document.type) {
    case "quote":
      return [
        document.details?.contractType ?? "",
        document.details?.depositPercent ?? null,
        document.details?.retainagePercent ?? null,
        document.details?.taxRate ?? null,
        document.details?.capCents ?? null,
      ];
    case "contract":
      return [
        document.details?.contractSumCents ?? 0,
        document.details?.depositCents ?? null,
        document.details?.depositBasis ?? "none",
        document.details?.retainagePercent ?? null,
      ];
    case "change_order":
      return [
        document.details?.deltaCents ?? 0,
        document.details?.timeImpactDays ?? null,
        ...(document.details?.baseAmountCents == null ? [] : [
          document.details.baseAmountCents,
          document.details.billingMode,
          document.details.taxRate,
          document.details.parentContractId,
          document.scope.filter(n => n.referencesNodeId).map(n => [n.referencesNodeId, n.referenceKind]),
        ]),
      ];
    case "invoice":
      return [
        document.details?.invoiceType ?? "",
        document.details?.amountDueCents ?? 0,
        document.details?.dueOn ?? null,
      ];
  }
}

/**
 * Whether a document still matches what somebody signed.
 *
 * The consistency check the dispute packet runs. A mismatch means the freeze
 * failed, which is a far more serious finding than a rendering bug — so this
 * returns the two digests rather than a boolean, and the caller reports both.
 */
export function verifySignedHash(
  document: AnyDocument,
  signedHash: string | null
): { verified: boolean; expected: string; recorded: string | null } {
  const expected = documentHash(document);
  return {
    verified: signedHash !== null && signedHash === expected,
    expected,
    recorded: signedHash,
  };
}
