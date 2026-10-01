import "server-only";
import { desc, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { productReleases } from "@/lib/db/schema";

export async function listReleases(includeDrafts = false) {
  return db.select().from(productReleases)
    .where(includeDrafts ? undefined : isNotNull(productReleases.publishedAt))
    .orderBy(desc(productReleases.createdAt), desc(productReleases.id));
}
