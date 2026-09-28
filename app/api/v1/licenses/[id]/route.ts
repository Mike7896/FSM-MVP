import { and, eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, noContent, ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { db } from "@/lib/db";
import { contractDetails, licenses, quoteDetails } from "@/lib/db/schema";
import { updateLicenseSchema } from "@/lib/schemas";

/**
 * `/api/v1/licenses/[id]` — one credential.
 *
 * Every statement is scoped by `organizationId` **in the same `where` as the
 * id**, not filtered afterwards. Drizzle bypasses RLS, so a license from
 * another shop must never come back at all rather than come back and get
 * hidden.
 */

export const PATCH = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller, {
      roles: BILLING_ROLES,
    });
    const body = await readJson(request, updateLicenseSchema);

    const [row] = await db
      .update(licenses)
      .set({
        ...body,
        updatedAt: new Date(),
      })
      .where(
        and(eq(licenses.id, id), eq(licenses.organizationId, organizationId))
      )
      .returning();

    if (!row) throw new ApiError("not_found", "That license isn't on file.");

    return ok(row);
  }
);

export const DELETE = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller, {
      roles: BILLING_ROLES,
    });

    /**
     * **A license that has stamped a document is not deleted.**
     *
     * A document's `license_id` is `on delete set null`, so removing one would
     * silently blank the license number on quotes that were already sent — and
     * a sent document is a record of what was offered, not a view that may be
     * rewritten later. The shop is told to let it lapse instead, which is what
     * actually happened.
     */
    const [[onQuote], [onContract]] = await Promise.all([
      db
        .select({ id: quoteDetails.documentId })
        .from(quoteDetails)
        .where(eq(quoteDetails.licenseId, id))
        .limit(1),
      db
        .select({ id: contractDetails.documentId })
        .from(contractDetails)
        .where(eq(contractDetails.licenseId, id))
        .limit(1),
    ]);
    const inUse = onQuote ?? onContract;

    if (inUse) {
      throw new ApiError(
        "conflict",
        "That license is printed on a quote you've already sent. Set its expiry instead of removing it — the documents it stamped have to keep saying what they said."
      );
    }

    const [row] = await db
      .delete(licenses)
      .where(
        and(eq(licenses.id, id), eq(licenses.organizationId, organizationId))
      )
      .returning({ id: licenses.id });

    if (!row) throw new ApiError("not_found", "That license isn't on file.");

    return noContent();
  }
);
