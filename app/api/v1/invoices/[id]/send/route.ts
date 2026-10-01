import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { sendInvoice } from "@/lib/documents";
import { sendInvoiceSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/invoices/[id]/send` — the bill goes out.
 *
 * Mirrors the quote's send: email through the product, or a link handed back
 * for the texts he already sends. Either way the link is minted first, the
 * letterhead is frozen onto the document, and the send is appended to the
 * record.
 */
export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, sendInvoiceSchema);

  return ok(
    await sendInvoice({
      organizationId,
      invoiceId: id,
      sender: { userId: caller.userId, email: caller.email },
      input: body,
    })
  );
});
