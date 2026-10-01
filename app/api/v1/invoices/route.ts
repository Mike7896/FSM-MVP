import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson, readQuery } from "@/lib/api/handler";
import { created, ok } from "@/lib/api/response";
import { createInvoice } from "@/lib/documents";
import { listInvoices } from "@/lib/queries/invoices";
import { createInvoiceSchema, listInvoicesSchema } from "@/lib/schemas";

/**
 * `/api/v1/invoices`
 *
 * **One object, three moments** — deposit, draw, final balance. What an invoice
 * may bill, the cap at what was agreed, and the phase it becomes are all
 * `createInvoice`'s rules; this endpoint authenticates and hands over.
 */

export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const query = readQuery(request, listInvoicesSchema);

  // Outstanding, overdue and days-past-due come back derived, exactly as the
  // web list shows them. Leaving the native app to work out whether an invoice
  // is late is how two clients start chasing different customers.
  return ok(await listInvoices(organizationId, query));
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const input = await readJson(request, createInvoiceSchema);

  const invoice = await createInvoice({ organizationId, input });
  return created(invoice, `/api/v1/invoices/${invoice.id}`);
});
