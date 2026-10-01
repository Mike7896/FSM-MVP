import { and, asc, eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, created, ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { db } from "@/lib/db";
import { licenses } from "@/lib/db/schema";
import { licenseSchema } from "@/lib/schemas";

/**
 * `/api/v1/licenses` — the credentials the shop holds.
 *
 * A License is an **Office object**: it outlives every job, is renewed on a
 * calendar, and supplies data to documents without ever being edited from one.
 * It connects to the job tree at exactly one point — the jurisdiction — which
 * is what a Permit is matched on, and why a missing local license is a job that
 * cannot legally start rather than a cosmetic problem on a page.
 *
 * **Jurisdiction plus number is unique per shop.** Holding the same number
 * twice in the same jurisdiction is a duplicate, not a second license, and the
 * conflict is reported rather than silently creating a row that will make the
 * gap warning wrong.
 */

export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  const rows = await db
    .select()
    .from(licenses)
    .where(eq(licenses.organizationId, organizationId))
    .orderBy(asc(licenses.expiresOn), asc(licenses.jurisdiction));

  return ok(rows);
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, {
    roles: BILLING_ROLES,
  });
  const body = await readJson(request, licenseSchema);

  const [duplicate] = await db
    .select({ id: licenses.id })
    .from(licenses)
    .where(
      and(
        eq(licenses.organizationId, organizationId),
        eq(licenses.jurisdiction, body.jurisdiction),
        eq(licenses.number, body.number)
      )
    )
    .limit(1);

  if (duplicate) {
    throw new ApiError(
      "conflict",
      `You already have ${body.number} on file for ${body.jurisdiction}.`
    );
  }

  const [row] = await db
    .insert(licenses)
    .values({
      organizationId,
      name: body.name ?? null,
      jurisdiction: body.jurisdiction,
      number: body.number,
      class: body.class,
      holder: body.holder,
      issuedOn: body.issuedOn ?? null,
      expiresOn: body.expiresOn ?? null,
      renewalReminderDays: body.renewalReminderDays ?? 60,
    })
    .returning();

  return created(row, `/api/v1/licenses/${row.id}`);
});
