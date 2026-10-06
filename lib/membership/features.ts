import "server-only";

import { ApiError } from "@/lib/api/response";
import { readAccess } from "./access";

/** Keep paid-library writes behind the same check for every client. */
export async function requireSavedItems(organizationId: string) {
  if (!(await readAccess(organizationId)).features.savedItems) {
    throw new ApiError("forbidden", "Saved items require Starter or Pro. Your existing quotes are unchanged.");
  }
}
