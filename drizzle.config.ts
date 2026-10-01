import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so it does not get .env.local for free.
config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DIRECT_URL (preferred) or DATABASE_URL must be set to run drizzle-kit."
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
  // Only manage the public schema. `auth`, `storage` and `realtime` belong to
  // Supabase - without this filter drizzle-kit would try to drop them.
  schemaFilter: ["public"],
  // Supabase creates these in the public schema for its own use.
  tablesFilter: ["!_prisma_migrations", "!supabase_migrations"],
  verbose: true,
  strict: true,
});
