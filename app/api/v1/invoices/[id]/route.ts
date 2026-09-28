import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, noContent, ok } from "@/lib/api/response";
import { updateInvoice, voidInvoice } from "@/lib/documents";
import { getInvoice } from "@/lib/queries/invoices";
import { updateInvoiceSchema } from "@/lib/schemas";

/**
 * `/api/v1/invoices/[id]`
 *
 * An issued invoice is frozen: its amount only moves while it's a draft, and it
 * is withdrawn by voiding rather than deleting. Those rules are
 * `updateInvoice`'s and `voidInvoice`'s.
 */

export const GET = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    const invoice = await getInvoice(id, organizationId);
    if (!invoice) {
      throw new ApiError("not_found", "No invoice with that id in this shop.");
    }
    return ok(invoice);
  }
);

export const PATCH = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);
    const input = await readJson(request, updateInvoiceSchema);

    return ok(await updateInvoice({ organizationId, invoiceId: id, input }));
  }
);

export const DELETE = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    const result = await voidInvoice({ organizationId, invoiceId: id });
    return result.outcome === "deleted" ? noContent() : ok(result);
  }
);
