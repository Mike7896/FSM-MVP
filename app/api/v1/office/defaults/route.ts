import { eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { db } from "@/lib/db";
import { officeDefaults } from "@/lib/db/schema";
import { updateOfficeDefaultsSchema } from "@/lib/schemas";

/**
 * `/api/v1/office/defaults` — where every new quote begins.
 *
 * **A default is a starting value.** Writing here changes what the *next* quote
 * starts from and touches nothing that already exists — no document is updated,
 * no sent quote is rewritten. That is the first question a contractor asks
 * before changing any of these, and the answer is a property of this endpoint
 * rather than a sentence on the page: there is no path from here to `quotes`.
 *
 * The row is upserted rather than assumed to exist, so an account created
 * before this table did can save without a separate provisioning step.
 */

export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  const [row] = await db
    .select()
    .from(officeDefaults)
    .where(eq(officeDefaults.organizationId, organizationId))
    .limit(1);

  // Absent is a real state — an Office with no opinion yet. Reported as an
  // empty set of defaults rather than a 404, because the caller wants to render
  // a form either way.
  return ok(row ?? { organizationId, ...EMPTY });
});

export const PATCH = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, {
    roles: BILLING_ROLES,
  });
  const body = await readJson(request, updateOfficeDefaultsSchema);

  // `numeric` columns take strings; passing a float is how a tax rate ends up
  // stored as 0.08250000000000001.
  const values = {
    depositPercent: body.depositPercent,
    materialMarkupPercent:
      body.materialMarkupPercent === null
        ? null
        : String(body.materialMarkupPercent),
    laborRateCents: body.laborRateCents,
    taxRate: body.taxRate === null ? null : String(body.taxRate),
    quoteValidityDays: body.quoteValidityDays,
    // An empty pattern is *no pattern*, not a pattern with no stages — the
    // difference is whether the editor offers draws at all.
    drawPattern: body.drawPattern?.length ? body.drawPattern : null,
    standardExclusions: body.standardExclusions,
    standardAssumptions: body.standardAssumptions,
    standardTerms: body.standardTerms,
    documentPreset: body.documentPreset,
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(officeDefaults)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({
      target: officeDefaults.organizationId,
      set: values,
    })
    .returning();

  return ok(row);
});

const EMPTY = {
  depositPercent: null,
  materialMarkupPercent: null,
  laborRateCents: null,
  taxRate: null,
  quoteValidityDays: 30,
  drawPattern: null,
  standardExclusions: null,
  standardAssumptions: null,
  standardTerms: null,
  documentPreset: "plain",
  defaultPresetId: null,
} as const;
