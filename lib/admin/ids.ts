import { z } from "zod";

import { ApiError } from "@/lib/api/response";

/** An account id from a URL — a mangled one is "no such account", not a server error. */
export function accountId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new ApiError("not_found", "No account with that id.");
  return id;
}
