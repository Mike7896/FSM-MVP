import "server-only";

import { db } from "@/lib/db";
import { officeDefaults } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import type { StoredSignatureInput } from "@/lib/schemas";

import { drawnMark, MarkError, typedMark } from "./mark";

/**
 * THE STORED SIGNATURE — Documents §5.
 *
 * Adopted once, in the Office, and applied by `acceptQuote` the moment a
 * customer approves. That is what lets the customer sign and pay the same
 * evening: the contract arrives with the business's signature already on it,
 * so nobody is waiting on a countersignature in the morning — and the customer
 * is never the first to commit to a document nobody stands behind.
 *
 * `autoSign` is the deferral §5 requires. Some contractors don't want their
 * business bound without a per-document action, and that is a legitimate way
 * to run a shop. With it off, or with nothing stored, a contract is generated
 * unsigned and waits for the business to sign it from the job.
 *
 * The mark is stored in exactly the form a signature row holds, so applying it
 * is a copy rather than a conversion.
 */

export type StoredSignature = {
  printedName: string | null;
  mark: string | null;
  autoSign: boolean;
};

export async function saveStoredSignature(
  organizationId: string,
  input: StoredSignatureInput
): Promise<StoredSignature> {
  const printedName = input.printedName.trim();

  let mark: string;
  try {
    mark =
      input.mark.kind === "drawn"
        ? drawnMark(input.mark.paths)
        : typedMark(printedName);
  } catch (error) {
    if (error instanceof MarkError) {
      throw new DomainError(error.message, "invalid");
    }
    throw error;
  }

  return write(organizationId, {
    signatureName: printedName,
    signatureMark: mark,
    autoSignContracts: input.autoSign,
  });
}

/** Whether new contracts carry the signature as they're generated. */
export function setAutoSign(organizationId: string, autoSign: boolean) {
  return write(organizationId, { autoSignContracts: autoSign });
}

/** Takes the signature off future contracts. Ones already signed keep it. */
export function clearStoredSignature(organizationId: string) {
  return write(organizationId, { signatureName: null, signatureMark: null });
}

async function write(
  organizationId: string,
  values: Partial<
    Pick<
      typeof officeDefaults.$inferInsert,
      "signatureName" | "signatureMark" | "autoSignContracts"
    >
  >
): Promise<StoredSignature> {
  const set = { ...values, updatedAt: new Date() };

  // Upserted: an Office that has never saved a default has no row yet.
  const [row] = await db
    .insert(officeDefaults)
    .values({ organizationId, ...set })
    .onConflictDoUpdate({ target: officeDefaults.organizationId, set })
    .returning();

  return {
    printedName: row.signatureName,
    mark: row.signatureMark,
    autoSign: row.autoSignContracts,
  };
}
