type Params = Record<string, string | string[] | undefined>;

/** A navigation preference only. Checkout still verifies releases and prices. */
export function purchaseQuery(params: Params): string | null {
  if (params.plan !== "starter" && params.plan !== "pro") return null;
  const query = new URLSearchParams({
    plan: params.plan,
    interval: params.interval === "year" ? "year" : "month",
  });
  if (params.pack === "electrical") query.set("pack", "electrical");
  return query.toString();
}

export function signupDestination(params: Params): string {
  const query = new URLSearchParams(purchaseQuery(params) ?? "");
  if (typeof params.trade === "string" && /^[a-z-]{1,40}$/.test(params.trade)) {
    query.set("trade", params.trade);
  }
  return `/welcome${query.size ? `?${query}` : ""}`;
}

export function validatedSignupDestination(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/welcome")) return "/welcome";
  const url = new URL(next, "https://serviceclerk.invalid");
  if (url.origin !== "https://serviceclerk.invalid" || url.pathname !== "/welcome") return "/welcome";
  return signupDestination(Object.fromEntries(url.searchParams));
}
