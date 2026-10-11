import { and, eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, created, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { customerNotes, customers } from "@/lib/db/schema";
import { listCustomerNotes } from "@/lib/queries/customers";
import { customerNoteSchema } from "@/lib/schemas";

/**
 * `/api/v1/customers/[id]/notes`
 *
 * The customer's notes log, newest first. Internal to the shop: no document
 * or share link reads it.
 */

async function requireCustomer(customerId: string, organizationId: string) {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.organizationId, organizationId)
      )
    )
    .limit(1);
  if (!customer) {
    throw new ApiError("not_found", "No customer with that id in this shop.");
  }
}

export const GET = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);
    await requireCustomer(id, organizationId);

    return ok(await listCustomerNotes(id, organizationId));
  }
);

export const POST = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);
    const body = await readJson(request, customerNoteSchema);
    await requireCustomer(id, organizationId);

    const [note] = await db
      .insert(customerNotes)
      .values({
        organizationId,
        customerId: id,
        body: body.body,
        createdBy: caller.userId,
      })
      .returning();

    return created(note, `/api/v1/customers/${id}/notes/${note.id}`);
  }
);
