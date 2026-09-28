import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

import { DocumentError } from "../errors";

/**
 * Deleting a quote.
 *
 * **Only one nobody has agreed to.** An accepted quote is the record of what the
 * contract was generated from, and the freeze trigger refuses to delete it —
 * this says so in words first.
 *
 * Its Scope, its link and its send history go with it. **The Job stays**: it may
 * carry captures, permits or a second quote, and deleting a document is not
 * deleting the work.
 */
export async function deleteQuote({
  organizationId,
  quoteId,
}: {
  organizationId: string;
  quoteId: string;
}): Promise<void> {
  const [row] = await db
    .select({ type: documents.type, frozenAt: documents.frozenAt })
    .from(documents)
    .where(
      and(eq(documents.id, quoteId), eq(documents.organizationId, organizationId))
    )
    .limit(1);

  if (!row || row.type !== "quote") {
    throw new DocumentError("No quote with that id in this shop.", "not_found");
  }

  if (row.frozenAt !== null) {
    throw new DocumentError(
      "This quote was accepted, so it stays — it's the record the contract was made from."
    );
  }

  await db.delete(documents).where(eq(documents.id, quoteId));
}
