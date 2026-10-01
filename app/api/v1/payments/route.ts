import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, created, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { documents, jobs } from "@/lib/db/schema";
import {
  LedgerError,
  recordEntry,
  reverseEntry,
  unattributedEntries,
} from "@/lib/ledger";
import { formatMoney } from "@/lib/quote/money";
import { processingAttempts } from "@/lib/stripe/collect";

/**
 * Money the contractor took off-platform — Object Model §5.3.
 *
 * **A cheque is exactly equal to a card here.** Payments taken outside the
 * platform are first-class, because a workflow that only counts money it
 * processed is a workflow contractors quietly stop using — and the moment the
 * app's number disagrees with the bank's, the app is the one that gets
 * abandoned.
 *
 * So this writes the same `payment_received` row a Stripe webhook writes, into
 * the same table, differing only in `source` and in carrying the person who
 * recorded it. Nothing downstream — the job's collected figure, the invoice's
 * outstanding balance, the gate that says he is safe to start — knows or cares
 * which door the money came through.
 */

const bodySchema = z.object({
  organizationId: z.uuid().optional(),

  /** Which bill this settles. The job comes from the invoice. */
  invoiceId: z.uuid().optional(),
  /** Or the job directly, for money with no bill behind it yet. */
  jobId: z.uuid().optional(),

  /** Positive cents. The direction is the entry type's job, not the caller's. */
  amountCents: z.number().int().positive(),
  method: z.enum(["card", "ach", "check", "cash", "venmo", "zelle", "other"]),

  /**
   * The day the money moved, not the day it was typed in.
   *
   * A cheque written Monday and entered Friday is a Monday event, and posting
   * it to Friday puts it in the wrong month at a quarter boundary.
   */
  occurredOn: z.iso.date(),

  memo: z.string().trim().max(500).optional(),
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const body = await readJson(request, bodySchema);

  const { organizationId } = await requireOrg(request, caller, {
    organizationId: body.organizationId,
    // A technician recording a cheque he collected on site is the normal case,
    // not an exception — dispatchers and technicians are in.
    roles: ["owner", "admin", "dispatcher", "technician"],
  });

  if (!body.invoiceId && !body.jobId) {
    throw new ApiError(
      "invalid_request",
      "Say which invoice or which job this payment is for."
    );
  }

  // Attribution is verified against the shop before anything is written. An id
  // arriving from a client is an assertion, not a fact, and Drizzle connects as
  // a role that bypasses RLS.
  const target = await resolveTarget(body, organizationId);

  try {
    const entry = await recordEntry({
      organizationId,
      entryType: "payment_received",
      amountCents: body.amountCents,
      // Noon UTC rather than midnight. A date-only value stored at midnight
      // lands on the previous day for anyone west of Greenwich, which turns a
      // payment recorded on the 1st into one dated the 31st.
      occurredAt: new Date(`${body.occurredOn}T12:00:00Z`),
      source: "manual",
      method: body.method,
      memo: body.memo ?? null,
      createdBy: caller.userId,
      ...target,
    });

    // `recordEntry` returns null only on a dedupe conflict, and a manual entry
    // has no external ref to conflict on. Reaching here means a constraint we
    // did not anticipate.
    if (!entry) {
      throw new ApiError("conflict", "That payment was not recorded. Try again.");
    }

    // A bank payment still clearing on the same invoice isn't cancelled or
    // replaced — both are real money until one fails — but the contractor is
    // told now, so a double collection is caught before it clears (Billing §8.3).
    const clearing = target.invoiceId ? await processingAttempts(target.invoiceId) : [];
    const warning = clearing.length
      ? `A bank payment of ${formatMoney(clearing.reduce((sum, row) => sum + row.amountCents, 0))} is still clearing on this invoice. If both go through, one of them will need refunding.`
      : null;

    return created({ ...entry, warning }, `/api/v1/payments/${entry.id}`);
  } catch (error) {
    if (error instanceof LedgerError) {
      throw new ApiError("invalid_request", error.message);
    }
    throw error;
  }
});

/**
 * Money that arrived with no job attached, waiting to be attributed.
 *
 * The matcher's inbox. It is a GET on this route rather than its own because it
 * answers the same question from the other side: what money do we know about
 * that nobody has told us the job for.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  return ok(await unattributedEntries(organizationId));
});

/**
 * Correcting a payment recorded against the wrong job.
 *
 * **Not an edit.** The original row stays, a reversing row cancels it, and a
 * third row puts the money where it belongs — which is what leaves both the
 * mistake and the fix in the record for a dispute packet or an auditor. The
 * ledger's `UPDATE` trigger would refuse an edit anyway; this is the supported
 * way to get the same outcome.
 */
const reattributeSchema = z.object({
  organizationId: z.uuid().optional(),
  entryId: z.uuid(),
  /** Where it should have gone. */
  invoiceId: z.uuid().optional(),
  jobId: z.uuid().optional(),
  memo: z.string().trim().min(1).max(500),
});

export const PATCH = handler(async (request) => {
  const caller = await requireCaller(request);
  const body = await readJson(request, reattributeSchema);

  const { organizationId } = await requireOrg(request, caller, {
    organizationId: body.organizationId,
    roles: ["owner", "admin"],
  });

  const target = await resolveTarget(body, organizationId);

  try {
    const reversal = await reverseEntry(body.entryId, {
      memo: body.memo,
      createdBy: caller.userId,
    });

    if (reversal.organizationId !== organizationId) {
      // `reverseEntry` reads by id alone, so the scope check happens here.
      // The reversal itself is harmless — it cancels a row in the other shop's
      // ledger and nets to zero — but it must not be followed by a re-post.
      throw new ApiError("not_found", "No such payment.");
    }

    const corrected = await recordEntry({
      organizationId,
      entryType: reversal.entryType,
      amountCents: -reversal.amountCents,
      occurredAt: reversal.occurredAt,
      source: reversal.source,
      method: reversal.method,
      memo: body.memo,
      createdBy: caller.userId,
      ...target,
    });

    return ok({ reversal, corrected });
  } catch (error) {
    if (error instanceof LedgerError) {
      throw new ApiError("invalid_request", error.message);
    }
    throw error;
  }
});

/* ── Attribution ──────────────────────────────────────────────────────── */

async function resolveTarget(
  body: { invoiceId?: string; jobId?: string },
  organizationId: string
): Promise<{ jobId: string | null; invoiceId: string | null; customerId: string | null }> {
  if (body.invoiceId) {
    const [row] = await db
      .select({
        invoiceId: documents.id,
        jobId: jobs.id,
        customerId: jobs.customerId,
      })
      .from(documents)
      .innerJoin(jobs, eq(documents.jobId, jobs.id))
      .where(
        and(
          eq(documents.id, body.invoiceId),
          eq(documents.type, "invoice"),
          eq(documents.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!row) throw new ApiError("not_found", "No such invoice.");
    return row;
  }

  if (body.jobId) {
    const [row] = await db
      .select({ jobId: jobs.id, customerId: jobs.customerId })
      .from(jobs)
      .where(
        and(eq(jobs.id, body.jobId), eq(jobs.organizationId, organizationId))
      )
      .limit(1);

    if (!row) throw new ApiError("not_found", "No such job.");
    return { jobId: row.jobId, invoiceId: null, customerId: row.customerId };
  }

  // Deliberately allowed: money the contractor knows arrived but cannot yet
  // place. It sits in the unattributed list above until he says where it goes.
  return { jobId: null, invoiceId: null, customerId: null };
}
