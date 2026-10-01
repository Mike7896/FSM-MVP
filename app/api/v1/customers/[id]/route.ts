import { and, eq, sql } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, noContent, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { getCustomer } from "@/lib/queries/customers";
import { updateCustomerSchema } from "@/lib/schemas";

/**
 * `/api/v1/customers/[id]`
 *
 * The single-customer CRUD the directory needs. Every handler scopes on
 * `organization_id` in the same statement that finds the row — Drizzle connects
 * as a role that bypasses RLS, so an id arriving from a client is an assertion
 * until a query has checked it against this shop.
 */

/**
 * Drizzle renders an embedded column **unqualified** inside a `sql` template in
 * a `.select()` projection — `${{table}}.id` becomes `"id"`, not
 * `"table"."id"`. Inside a correlated subquery whose own table also has an `id`
 * column that is ambiguous, and Postgres rejects it (42702). It qualifies
 * correctly in `orderBy`, which is what makes the failure so easy to miss.
 *
 * These constants are the explicit reference. Never interpolate a bare column
 * into a correlated subquery.
 */
const CUSTOMER_ID = sql.raw('"customers"."id"');

export const GET = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    const customer = await getCustomer(id, organizationId);
    if (!customer) {
      throw new ApiError("not_found", "No customer with that id in this shop.");
    }
    return ok(customer);
  }
);

export const PATCH = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);
    const body = await readJson(request, updateCustomerSchema);

    const [updated] = await db
      .update(customers)
      .set({
        ...body,
        // An empty email is how a form clears one; storing "" would make the
        // column lie about having a value.
        email: body.email === "" ? null : body.email,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customers.id, id),
          eq(customers.organizationId, organizationId)
        )
      )
      .returning();

    if (!updated) {
      throw new ApiError("not_found", "No customer with that id in this shop.");
    }

    return ok(updated);
  }
);

/**
 * Deleting is refused while the customer still has work.
 *
 * `jobs.customer_id` is `on delete restrict`, so the database would refuse this
 * anyway — but it would surface as an opaque driver error. Checking first turns
 * it into a sentence a contractor can act on, and states the real reason: a Job
 * carries the documents, the money and the compliance record, and none of that
 * should vanish because somebody tidied a directory.
 */
export const DELETE = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    const [existing] = await db
      .select({
        id: customers.id,
        jobCount: sql<number>`(
          select count(*)::int from jobs j where j.customer_id = ${CUSTOMER_ID}
        )`,
      })
      .from(customers)
      .where(
        and(eq(customers.id, id), eq(customers.organizationId, organizationId))
      )
      .limit(1);

    if (!existing) {
      throw new ApiError("not_found", "No customer with that id in this shop.");
    }

    if (existing.jobCount > 0) {
      throw new ApiError(
        "conflict",
        `This customer has ${existing.jobCount} job${existing.jobCount === 1 ? "" : "s"}. Deleting them would take the quotes, invoices and permits with it.`,
        { jobCount: existing.jobCount }
      );
    }

    await db
      .delete(customers)
      .where(
        and(eq(customers.id, id), eq(customers.organizationId, organizationId))
      );

    return noContent();
  }
);
