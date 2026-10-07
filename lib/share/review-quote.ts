import "server-only";
import { loadDocument, type Executor } from "@/lib/documents/repository";
import { DomainError } from "@/lib/errors";
import { quoteReviewHash } from "@/lib/signing/quote-review";

/** Caller holds the document row lock until acceptance/signing commits. */
export async function requireReviewedQuote(id: string, organizationId: string, hash: string | undefined, on: Executor) {
  const quote = await loadDocument(id, organizationId, on);
  if (!quote || quote.type !== "quote") throw new DomainError("Quote not found.", "not_found");
  if (!hash || hash !== quoteReviewHash(quote)) {
    throw new DomainError("This quote has changed. Reload and review the current price, scope, and payment schedule before accepting.", "conflict");
  }
}
