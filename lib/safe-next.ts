/**
 * Where to send someone after an auth step, from a `next` they handed us.
 *
 * `next` arrives in a query string anyone can write, so only same-origin
 * relative paths survive. An absolute URL would make the sign-in page an open
 * redirect that phishing links borrow this domain for — and so would `//host`
 * and `/\host`, which browsers read as protocol-relative URLs.
 *
 * Client-safe: the forms call it before navigating, the routes before
 * redirecting.
 */
export function safeNextPath(next: unknown, fallback = "/dashboard"): string {
  return typeof next === "string" &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.startsWith("/\\")
    ? next
    : fallback;
}
