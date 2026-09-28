/**
 * SIGNING — DocuSign-shaped, without DocuSign.
 *
 * No envelope round-trip, no webhook, no per-signature fee, and the signed
 * artifact lives in our own database rather than on a vendor's system.
 *
 * What a vendor sells is not the drawing tool — it is the four things that make
 * a mark into evidence, and each one is a module here:
 *
 * - `mark` — what a signature *is*: an adopted name, or SVG path data. Both are
 *   signatures under ESIGN; neither is a 40 KB PNG.
 * - `disclosure` — the electronic-records consent ESIGN §101(c) requires before
 *   a signature binds a consumer. The step most in-house builds skip.
 * - `hash` — SHA-256 of what was on the page, which is what "logically
 *   associated with the record" means in practice.
 * - `sign` — the write, with every audit field captured server-side.
 * - `certificate` — the Certificate of Completion, recomputed at read time so
 *   it is capable of reporting that something is wrong.
 * - `stored` — the business's adopted signature, applied to a contract the
 *   moment a customer approves.
 */

export * from "./mark";
export * from "./disclosure";
export * from "./hash";
export * from "./sign";
export * from "./certificate";
export * from "./stored";
