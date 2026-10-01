import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { composeQuoteEmail, liveShareLink, shareUrl } from "@/lib/documents";
import { previewQuoteEmailSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/quotes/[id]/send/preview` — the email, before it goes.
 *
 * Composed by the same function the send uses, from the quote as it stands and
 * the words in the sheet, so what the contractor checks is what the customer
 * gets. Nothing is written: a quote that has never gone out has no link yet,
 * and looking at its email doesn't mint one.
 */
export const POST = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);
    const input = await readJson(request, previewQuoteEmailSchema);

    const link = await liveShareLink(id);
    const email = await composeQuoteEmail({
      organizationId,
      quoteId: id,
      message: input.message ?? null,
      subject: input.subject ?? null,
      url: link ? shareUrl(link.token) : null,
    });

    return ok({
      subject: email.subject,
      html: email.html,
      message: email.message,
      from: email.fromName,
    });
  }
);
