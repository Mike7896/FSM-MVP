/**
 * THE OPERATIONS — Documents §8, plus the everyday writes around them.
 *
 * **This is not an engine.** An engine runs rules held as data; these are
 * genuinely different pieces of logic, not settings on one routine, so they are
 * ordinary functions over a shared type in ordinary SQL and TypeScript. The
 * engine-shaped part of this product is the six price structures, and that
 * lives on the rendering side — it reads these documents and never changes
 * them.
 *
 * **Route handlers call these; they don't reimplement them.** An endpoint
 * authenticates, validates the body and hands the result on. The rules — what
 * freezes, what a send requires, what a demo may reach, what can be billed —
 * live here, where the native app's endpoints, the webhooks and the scripts
 * meet the same ones.
 *
 * | # | Operation | Writes |
 * |---|---|---|
 * | 1 | `acceptQuote` | Contract + copied nodes + contractor signature; freezes the Quote |
 * | 2 | `issueDepositInvoice` | The deposit Invoice and its link, issued by the signature that completes a Contract |
 * | 3 | `issueDrawInvoice` | *pending* — `createInvoice` with a phase stands in |
 * | 4 | `issueFinalInvoice` | *pending* — the settlement, and the one to unit-test hardest |
 * | 5 | `createChangeOrder` | *pending* |
 * | 6 | `invoiceChangeOrder` | *pending* |
 * | 7 | `currentAgreedScope` | **Nothing** — a fold, computed at read time |
 * | 8 | `duplicateQuote` | New draft Quote + copied nodes |
 * | 9 | `reviseQuote` | *pending* |
 *
 * And the writes every document needs before any of those: `createQuote`,
 * `saveQuote`, `deleteQuote`, `sendQuote`, `recordShareView`, and for invoices
 * `createInvoice`, `updateInvoice` and `voidInvoice`.
 */

export * from "./agreed-scope";
export * from "./accept-quote";
export * from "./create-quote";
export * from "./save-quote";
export * from "./duplicate-quote";
export * from "./delete-quote";
export * from "./send-quote";
export * from "./send-contract";
export * from "./record-view";
export * from "./create-invoice";
export * from "./issue-deposit";
export * from "./issue-draw";
export * from "./issue-final";
export * from "./send-invoice";
export * from "./update-invoice";
export * from "./void-invoice";
