/**
 * SIGNATURE LINES — what the foot of a quote or contract says about who has
 * signed, and whether the customer accepts by signing.
 *
 * No React, no I/O: the editor, the paper and the share page all decide from
 * this one definition, so the line the contractor previews and the line the
 * customer signs cannot disagree about whose signature is on it.
 */

/**
 * The business's adopted signature, as the Office keeps it.
 *
 * `autoSign` is the Office's "sign automatically" switch. Off, the signature is
 * stored but never applied on the business's behalf — every document waits for
 * a signature given by hand.
 */
export type OfficeSignature = {
  printedName: string;
  mark: string;
  autoSign: boolean;
};

/** One party's mark on a line — recorded, or about to be applied. */
export type LineSignature = {
  mark: string;
  printedName: string;
  /**
   * When it was signed. Null for the business's signature drawn on a quote
   * ahead of acceptance: it is applied, with a time, the moment she signs.
   */
  signedAt: Date | string | null;
};

export type DocumentSignatures = {
  contractor: LineSignature | null;
  customer: LineSignature | null;
};

/**
 * The signature the business's line carries before anything is agreed — the
 * stored one, when the Office will apply it.
 *
 * Null when there is nothing stored, or when the shop signs each document by
 * hand: a line showing a signature the business has not given would be the
 * business committing without the per-document act it asked for.
 */
export function appliedSignature(
  signature: OfficeSignature | null | undefined
): LineSignature | null {
  if (!signature || !signature.autoSign) return null;
  return {
    mark: signature.mark,
    printedName: signature.printedName,
    signedAt: null,
  };
}

/**
 * Whether the customer accepts this quote by signing it.
 *
 * Needs the lines on **and** the business's signature ready to apply. Without
 * the second, signing the quote would make the customer the first to commit
 * to a document nobody stands behind — so it falls back to approving with a
 * button and signing the contract once the business has.
 */
export function signsOnQuote(
  draft: { signatureLines: boolean },
  signature: OfficeSignature | null | undefined
): boolean {
  return draft.signatureLines && appliedSignature(signature) !== null;
}
