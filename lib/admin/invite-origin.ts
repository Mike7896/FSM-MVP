import { DomainError } from "@/lib/errors";

/** Email links must point at an explicitly configured, externally reachable app. */
export function inviteOrigin(requestOrigin: string, configuredUrl: string | undefined, send: boolean): string {
  let url: URL;
  try {
    url = new URL(configuredUrl || requestOrigin);
  } catch {
    throw new DomainError("Set NEXT_PUBLIC_SITE_URL to the public URL of this app before creating an invite.", "invalid");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new DomainError("NEXT_PUBLIC_SITE_URL must be the app's base URL, without a path, query, or credentials.", "invalid");
  }
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "[::1]" || host === "[::]" || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (send && (!configuredUrl || local || url.protocol !== "https:")) {
    throw new DomainError("Set NEXT_PUBLIC_SITE_URL to the public HTTPS address where this app is deployed before emailing an invite. A localhost link only works on your computer. The account has not been changed.", "invalid");
  }
  return url.origin;
}
