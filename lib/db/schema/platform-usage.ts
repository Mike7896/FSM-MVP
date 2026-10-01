import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ProviderUsage } from "@/lib/admin/usage-model";

export const platformUsage = pgTable("platform_usage", {
  id: text("id").primaryKey(),
  configuration: jsonb("configuration").$type<ProviderUsage>().notNull(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
