import type { NextRequest } from "next/server";

/**
 * The caller's address, as far as it can be known.
 *
 * Behind Vercel's proxy the socket address is the proxy's, so the forwarded
 * header is what carries the client — and its *first* entry is the client,
 * everything after being the hops. It is spoofable by anyone talking directly
 * to the origin, which is why a signature certificate presents it as "recorded
 * from the request" rather than as a proven fact: it is corroborating evidence,
 * not identity.
 */
export function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip");
}
