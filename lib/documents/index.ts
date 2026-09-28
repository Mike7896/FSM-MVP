/**
 * THE DOCUMENTS — the truth of what is **owed**.
 *
 * The other half of `lib/ledger`, which is the truth of what **moved**. Every
 * number on the Job hub's money card except *collected to date* comes from
 * here, and nothing here ever writes a ledger row: issuing an invoice changes
 * what is owed and moves no money, which is the cash-only decision carried in
 * from the money design.
 *
 * - `lifecycle` — `{type, status} → mutable`, the one lookup, read by the
 *   database trigger and by the client so the UI disables exactly what the
 *   database would reject.
 * - `types` — one `Document` interface, four extensions, discriminated on
 *   `type`.
 * - `repository` — loading one, in a single round trip whichever type it is.
 * - `scope` — the arithmetic over the Scope tree; `scope-write` — replacing it.
 * - `header` — the letterhead, frozen at send.
 * - `share-links` — the link the customer holds.
 * - `quote-record` — a quote in the shape the editor and the API speak.
 * - `operations` — every write: the nine transformations and the everyday
 *   create, save, send and view around them.
 * - `errors` — what they throw when a rule says no.
 */

export * from "./lifecycle";
export * from "./types";
export * from "./scope";
export * from "./scope-write";
export * from "./repository";
export * from "./header";
export * from "./share-links";
export * from "./quote-record";
export * from "./errors";
export * from "./operations";
