import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformUsage } from "@/lib/db/schema";
import { defaultProviders, providerUsageSchema, type ProviderUsage, type SavedProvider } from "./usage-model";

export async function getUsageProviders(): Promise<SavedProvider[]> {
  const rows = await db.select().from(platformUsage);
  const saved = rows.map((r) => ({ ...providerUsageSchema.parse(r.configuration), updatedAt: r.updatedAt.toISOString() }));
  return [...defaultProviders().filter((p) => !saved.some((s) => s.id === p.id)), ...saved].sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveUsageProvider(input: ProviderUsage, userId: string) {
  const configuration = providerUsageSchema.parse(input);
  await db.transaction(async (tx) => {
    await tx.insert(platformUsage).values({ id: configuration.id, configuration, updatedBy: userId })
      .onConflictDoUpdate({ target: platformUsage.id, set: { configuration, updatedBy: userId, updatedAt: new Date() } });
    await tx.execute(sql`select public.admin_log('platform.usage.updated', 'activity', null, ${userId}::uuid,
      ${`Updated ${configuration.name} costs and usage`}, null, false,
      ${JSON.stringify({ provider: configuration.id, start: configuration.start, end: configuration.end })}::jsonb)`);
  });
}
