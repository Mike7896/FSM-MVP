/**
 * THE SCHEDULE — who is where, when.
 *
 * - `types` — the vocabulary the page and the API share. Client-safe.
 * - `dates` — calendar arithmetic on the viewer's clock. Client-safe.
 * - `title` — how a visit is named on the calendar. Client-safe.
 * - `service` — reads and writes, with double-booking said rather than refused.
 */
export * from "./service";
export * from "./types";
