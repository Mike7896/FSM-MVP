import { requireAdminCaller } from "@/lib/admin/access";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, created } from "@/lib/api/response";
import { db } from "@/lib/db";
import { productReleases } from "@/lib/db/schema";
import { releaseInput } from "@/lib/schemas/product-release";

export const POST = handler(async request => {
  const admin = await requireAdminCaller(request);
  const input = await readJson(request, releaseInput);
  const [row] = await db.insert(productReleases).values({ ...input, createdBy: admin.userId }).onConflictDoNothing().returning();
  if (!row) throw new ApiError("conflict", "That version already exists. Choose a new version.");
  return created(row);
});
