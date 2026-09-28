import { pgSchema, uuid } from "drizzle-orm/pg-core";

/**
 * Supabase manages `auth.users` itself - migrations must never create or alter
 * it. This is a *reference only* declaration so our own tables can declare real
 * foreign keys against it. It is excluded from `drizzle-kit` output via the
 * `schemaFilter` in drizzle.config.ts.
 */
export const authSchema = pgSchema("auth");

export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});
