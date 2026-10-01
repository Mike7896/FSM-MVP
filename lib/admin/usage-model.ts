import { z } from "zod";

const amount = z.number().finite().nonnegative().max(1e15).nullable();
const date = z.iso.date();
export const usageMetricSchema = z.object({
  name: z.string().trim().min(1).max(100),
  unit: z.string().trim().min(1).max(30),
  used: amount,
  limit: amount,
  behavior: z.enum(["overage", "hard", "budget"]),
});
export const providerUsageSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  name: z.string().trim().min(1).max(80),
  plan: z.string().trim().max(100),
  scope: z.string().trim().min(1).max(200),
  start: date,
  end: date,
  asOf: date,
  currency: z.enum(["USD", "CAD", "EUR", "GBP"]),
  recurring: amount,
  reported: amount,
  notes: z.string().trim().max(1000),
  metrics: z.array(usageMetricSchema).max(30),
}).refine((v) => v.end > v.start, { message: "The end date must follow the start date.", path: ["end"] })
  .refine((v) => v.asOf >= v.start && v.asOf < v.end, { message: "The observation date must be inside the billing period.", path: ["asOf"] })
  .refine((v) => v.asOf <= new Date().toISOString().slice(0, 10), { message: "The observation date cannot be in the future.", path: ["asOf"] });
export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export type UsageMetric = z.infer<typeof usageMetricSchema>;
export type SavedProvider = ProviderUsage & { updatedAt: string | null };
export type LiveUsage = { provider: string; status: "connected" | "setup" | "error"; message: string; asOf: string | null; metrics: (UsageMetric & { reset?: string })[]; cost?: number; currency?: string; period?: string };

export function headroom(used: number | null, limit: number | null) {
  if (used === null || limit === null) return null;
  return { remaining: Math.max(0, limit - used), excess: Math.max(0, used - limit), percent: limit === 0 ? (used > 0 ? 100 : 0) : used / limit * 100 };
}

export function defaultProviders(now = new Date()): SavedProvider[] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  return [
    { id: "vercel", name: "Vercel", scope: "Team", metrics: [["Active CPU", "hours"], ["Data transfer", "GB"], ["Edge requests", "requests"]] },
    { id: "supabase", name: "Supabase", scope: "Organization / project — specify which", metrics: [["Database size", "GB"], ["Egress", "GB"], ["Storage", "GB"], ["Monthly active users", "users"]] },
    { id: "resend", name: "Resend", scope: "Resend account", metrics: [["Monthly emails", "emails"]] },
  ].map((p) => ({ ...p, plan: "", start, end, asOf: now.toISOString().slice(0, 10), currency: "USD", recurring: null, reported: null, notes: "", updatedAt: null,
    metrics: p.metrics.map(([name, unit]) => ({ name, unit, used: null, limit: null, behavior: "overage" })) }));
}
