import { eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { updateOfficeSchema } from "@/lib/schemas";

/**
 * `/api/v1/office` — the business itself: name, address, contact, logo.
 *
 * These are the Office's own attributes (Object Model §5.1) — the ones every
 * outbound document draws on, which is what lets a document header cite a
 * defined source instead of an undefined profile field.
 *
 * Scoped to the caller's organization rather than taking an id in the path:
 * there is one Office per request and `requireOrg` already resolved it, so a
 * route that also accepted an id would be a second place the wrong one could be
 * named.
 *
 * **Owner and admin only.** This is what the customer reads at the top of every
 * document the business sends, and a technician changing the business name is
 * not a settings mistake — it is a change to every quote in flight.
 */

const COLUMNS = {
  id: organizations.id,
  name: organizations.name,
  slug: organizations.slug,
  phone: organizations.phone,
  email: organizations.email,
  address: organizations.address,
  website: organizations.website,
  logoUrl: organizations.logoUrl,
};

export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  const [row] = await db
    .select(COLUMNS)
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  return ok(row);
});

export const PATCH = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, {
    roles: BILLING_ROLES,
  });
  const body = await readJson(request, updateOfficeSchema);

  const [row] = await db
    .update(organizations)
    .set({
      name: body.name,
      phone: body.phone,
      email: body.email,
      address: body.address,
      website: body.website,
      logoUrl: body.logoUrl,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId))
    .returning(COLUMNS);

  return ok(row);
});
