import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson, readQuery } from "@/lib/api/handler";
import { created, ok } from "@/lib/api/response";
import { createCustomer } from "@/lib/customers/service";
import { listCustomers } from "@/lib/queries/customers";
import { createCustomerSchema, listCustomersSchema } from "@/lib/schemas";

/**
 * `/api/v1/customers`
 *
 * The customer directory. Job count and open balance are derived rather than
 * stored, so they cannot drift.
 */

export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const query = readQuery(request, listCustomersSchema);

  // Job count, open balance and last-job date come back derived, the same as
  // the web directory shows them. Returning bare rows would leave the native
  // app to compute them, which is how two clients start disagreeing about what
  // somebody owes.
  return ok(await listCustomers(organizationId, query));
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, createCustomerSchema);

  const customer = await createCustomer({
    organizationId,
    userId: caller.userId,
    input: body,
  });

  return created(customer, `/api/v1/customers/${customer.id}`);
});
