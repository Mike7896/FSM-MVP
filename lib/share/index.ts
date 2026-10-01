/**
 * THE CUSTOMER'S LINK — what someone with no account can do from it.
 *
 * Flow 2's chain, one document and one link at a time: approve the quote, which
 * generates the contract → sign the contract, which issues the deposit → pay
 * the deposit. Reading what a link shows lives in `lib/queries/share.ts`;
 * paying is Stripe's form behind `/api/share/[token]/pay`. These are the acts in
 * between, and each re-checks the token rather than trusting the page it came
 * from.
 */
export { approveFromLink } from "./approve";
export { linkedType } from "./link";
export { signFromLink } from "./sign";
export { signQuoteFromLink } from "./sign-quote";
