import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { previewCustomerImport } from "@/lib/import/customers";
import { previewImportSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/import/customers/preview` — what this file would do.
 *
 * **Writes nothing**, which is the point: the contractor sees every row and
 * what would happen to it before a single one lands. A POST rather than a GET
 * because the file is the body, not because anything changes.
 */
export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const { csv } = await readJson(request, previewImportSchema);

  return ok(await previewCustomerImport(organizationId, csv));
});
