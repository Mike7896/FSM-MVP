import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  documents,
  jobs,
  officeDefaults,
  quoteDetails,
} from "@/lib/db/schema";
import type { QuoteRecord } from "@/lib/quote";
import type { UpdateQuoteInput } from "@/lib/schemas";

import { DocumentError } from "../errors";
import { isMutable } from "../lifecycle";
import { readQuoteRecord } from "../quote-record";
import { writeScopeTree } from "../scope-write";

/**
 * `saveQuote` — the editor's autosave.
 *
 * Everything the contractor changes comes back through here: a rate, the scope
 * prose, the deposit, the order of the rows. **The Scope tree is replaced as a
 * set in the same transaction as the document**, so a dropped request can
 * never leave rows that don't add up to the total he was looking at.
 *
 * **An accepted quote is refused before the database refuses it.** The freeze
 * trigger would reject the write anyway; saying so first turns a failed
 * autosave with a driver message into a sentence about what to do instead.
 */

/** The five decisions and their money terms, as they sit on `quote_details`. */
const TERM_KEYS = [
  "contractType",
  "priceStructure",
  "scopeDetail",
  "pricingMethod",
  "estimatingMethod",
  "estimateClass",
  "billingTrigger",
  "moneyUpFront",
  "depositPercent",
  "progressBilling",
  "retainagePercent",
  "capCents",
] as const;

export async function saveQuote({
  organizationId,
  quoteId,
  input,
}: {
  organizationId: string;
  quoteId: string;
  input: UpdateQuoteInput;
}): Promise<QuoteRecord> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        type: documents.type,
        status: documents.status,
        frozenAt: documents.frozenAt,
        jobId: documents.jobId,
        customerId: documents.customerId,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, quoteId),
          eq(documents.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!row || row.type !== "quote") {
      throw new DocumentError("No quote with that id in this shop.", "not_found");
    }

    if (row.frozenAt !== null || !isMutable("quote", row.status)) {
      throw new DocumentError(
        "This quote has been accepted, so it can't change now — the contract is the agreed document. Agreed work changes through a change order."
      );
    }

    /* ── Who it's for ─────────────────────────────────────────────────── */

    // The editor edits a name, not a customer record: he is correcting who the
    // quote is for, and the Job's customer follows. An explicit `customerId`
    // reassigns instead, for the picker.
    let customerId = row.customerId;

    if (input.customerId) {
      const [target] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, input.customerId),
            eq(customers.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!target) {
        throw new DocumentError(
          "No customer with that id in this shop.",
          "not_found"
        );
      }

      customerId = target.id;
      await tx
        .update(jobs)
        .set({ customerId, updatedAt: new Date() })
        .where(eq(jobs.id, row.jobId));
    } else if (input.customerName && customerId) {
      await tx
        .update(customers)
        .set({ name: input.customerName, updatedAt: new Date() })
        .where(
          and(
            eq(customers.id, customerId),
            eq(customers.organizationId, organizationId)
          )
        );
    }

    /* ── The document ─────────────────────────────────────────────────── */

    const patch: Partial<typeof documents.$inferInsert> = {
      customerId,
      updatedAt: new Date(),
    };
    if (input.title !== undefined) patch.title = input.title;
    if (input.summary !== undefined) patch.summary = input.summary;

    await tx.update(documents).set(patch).where(eq(documents.id, quoteId));

    /* ── The five decisions ───────────────────────────────────────────── */

    const details: Partial<typeof quoteDetails.$inferInsert> = {};
    if (input.taxRate !== undefined) {
      details.taxRate = input.taxRate === null ? null : String(input.taxRate);
    }
    if (input.licenseId !== undefined) details.licenseId = input.licenseId;
    if (input.commitmentSummary !== undefined) {
      details.commitmentSummary = input.commitmentSummary;
    }
    if (input.signatureLines !== undefined) {
      details.signatureLines = input.signatureLines;
    }
    for (const key of TERM_KEYS) {
      const value = input.terms?.[key];
      if (value !== undefined) {
        (details as Record<string, unknown>)[key] = value;
      }
    }

    // The editor sends the quote's phases with every save, and they are the
    // quote's own: what it sends is what is kept.
    if (input.terms?.phases !== undefined) {
      details.drawPattern = input.terms.phases.length ? input.terms.phases : null;
    }
    if (input.terms?.phaseSplit !== undefined) {
      details.phaseSplit = input.terms.phaseSplit;
    }

    // A client that says nothing about phases gets the shop's pattern copied on
    // when billing in stages is switched on. Before that there is no schedule
    // to show; after it, the snapshot is the quote's own and the Office may
    // change its mind freely.
    if (
      input.terms?.progressBilling === "draws" &&
      input.terms.phases === undefined
    ) {
      const [current] = await tx
        .select({ drawPattern: quoteDetails.drawPattern })
        .from(quoteDetails)
        .where(eq(quoteDetails.documentId, quoteId))
        .limit(1);

      if (!current?.drawPattern?.length) {
        const [defaults] = await tx
          .select({ drawPattern: officeDefaults.drawPattern })
          .from(officeDefaults)
          .where(eq(officeDefaults.organizationId, organizationId))
          .limit(1);

        if (defaults?.drawPattern?.length) {
          details.drawPattern = defaults.drawPattern;
        }
      }
    }

    if (Object.keys(details).length) {
      // An upsert rather than an update: a quote written before its details
      // row existed still saves, instead of silently dropping its terms.
      await tx
        .insert(quoteDetails)
        .values({ documentId: quoteId, ...details })
        .onConflictDoUpdate({ target: quoteDetails.documentId, set: details });
    }

    /* ── The Scope tree ───────────────────────────────────────────────── */

    // Absent means "don't touch it", which is what makes a terms-only save
    // cheap. An empty array genuinely means "no rows".
    if (input.scope) {
      await writeScopeTree(
        tx,
        { documentId: quoteId, organizationId },
        input.scope
      );
    }

    const record = await readQuoteRecord(quoteId, organizationId, tx);
    if (!record) {
      throw new DocumentError(
        "The quote saved but couldn't be read back.",
        "failed"
      );
    }
    return record;
  });
}
