import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { created } from "@/lib/api/response";
import { commitCustomerImport } from "@/lib/import/customers";
import { importCustomersSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/import/customers` — the rows the contractor confirmed.
 *
 * The preview decided what each row was; this writes the ones they kept. It
 * takes the reviewed rows rather than the file, so what lands is exactly what
 * was on screen when they pressed the button.
 */
export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const { rows } = await readJson(request, importCustomersSchema);

  return created(await commitCustomerImport(organizationId, rows));
});
