import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { readAccess } from "@/lib/membership/access";
import { ApiError, ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { db } from "@/lib/db";
import { officeDefaults } from "@/lib/db/schema";
import { updateOfficeBrandingSchema } from "@/lib/schemas";

/**
 * `/api/v1/office/branding` — how the business looks on a document.
 *
 * **Document branding, not appearance.** This is how the business looks to a
 * homeowner, on the PDF and on the share surface, and the two read the same
 * preset so they cannot drift. How the *app* looks to the contractor is a
 * per-person preference that lives in Settings and stores nothing here.
 *
 * It writes one column of `office_defaults` rather than owning a table: the
 * preset is a document default like the deposit percentage, and giving it its
 * own row would be a second place the Office's document settings live.
 *
 * A preset applies to documents rendered from now on. Nothing already sent
 * changes — a homeowner holding a link does not watch the letterhead move.
 */
export const PATCH = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, {
    roles: BILLING_ROLES,
  });
  const body = await readJson(request, updateOfficeBrandingSchema);
  if (!(await readAccess(organizationId)).features.branding) {
    throw new ApiError("forbidden", "Document branding requires Pro.");
  }

  const [row] = await db
    .insert(officeDefaults)
    .values({ organizationId, documentPreset: body.documentPreset })
    .onConflictDoUpdate({
      target: officeDefaults.organizationId,
      set: { documentPreset: body.documentPreset, updatedAt: new Date() },
    })
    .returning({ documentPreset: officeDefaults.documentPreset });

  return ok(row);
});
