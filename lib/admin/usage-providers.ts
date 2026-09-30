import "server-only";
import { z } from "zod";
import type { LiveUsage } from "./usage-model";

const count = z.number().finite().nonnegative();
const emailWindow = z.object({ used: count, limit: count.nullable(), resets_at: z.iso.datetime({ offset: true }) });
const resendSchema = z.object({ emails: z.object({ daily: emailWindow, monthly: emailWindow }) });
const chargeSchema = z.object({
  BilledCost: z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().finite()), BillingCurrency: z.string().regex(/^[A-Z]{3}$/),
  SkuId: z.string().nullish(), ServiceName: z.string().nullish(),
  ConsumedQuantity: z.coerce.number().finite().nonnegative().nullable(), ConsumedUnit: z.string().nullable(),
});

async function get(url: string, token: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "The API key cannot read usage. Check its permissions and account access." : `Provider returned HTTP ${response.status}. Try refreshing later.`);
  return response;
}
const failed = (provider: string, error: unknown): LiveUsage => ({ provider, status: "error", asOf: null, metrics: [], message: error instanceof Error && error.message.startsWith("The API key") ? error.message : "Usage could not be retrieved. Check provider access and try refreshing." });

async function resendUsage(): Promise<LiveUsage> {
  const token = process.env.RESEND_USAGE_API_KEY || process.env.RESEND_API_KEY;
  if (!token) return { provider: "Resend", status: "setup", message: "Set RESEND_USAGE_API_KEY on the server to read account usage.", asOf: null, metrics: [] };
  try {
    const data = resendSchema.parse(await (await get("https://api.resend.com/usage", token)).json());
    return { provider: "Resend", status: "connected", asOf: new Date().toISOString(), message: "Account-wide email usage, including sent and received messages. A missing daily limit means no daily cap. Check your plan for overage terms.",
      metrics: Object.entries(data.emails).map(([window, value]) => ({ name: `${window === "daily" ? "Daily" : "Monthly"} emails`, unit: "emails", used: value.used, limit: value.limit, behavior: "budget", reset: value.resets_at })) };
  } catch (error) { return failed("Resend", error); }
}

async function vercelUsage(): Promise<LiveUsage> {
  const token = process.env.VERCEL_USAGE_API_TOKEN;
  const team = process.env.VERCEL_USAGE_TEAM_ID;
  if (!token || !team) return { provider: "Vercel", status: "setup", message: "Set VERCEL_USAGE_API_TOKEN and VERCEL_USAGE_TEAM_ID on the server to read team charges and usage.", asOf: null, metrics: [] };
  try {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const query = new URLSearchParams({ teamId: team, from: start.toISOString(), to: now.toISOString() });
    const response = await get(`https://api.vercel.com/v1/billing/charges?${query}`, token);
    // The billing endpoint returns JSON Lines, not a JSON array.
    const body = await response.text();
    const rows = body.split(/\r?\n/).filter((line) => line.trim()).map((line) => chargeSchema.parse(JSON.parse(line)));
    const currencies = new Set(rows.map((r) => r.BillingCurrency));
    if (currencies.size > 1) throw new Error("Mixed currencies");
    const quantities = new Map<string, { name: string; unit: string; used: number }>();
    for (const row of rows) {
      if (row.ConsumedQuantity === null || !row.ConsumedUnit) continue;
      const name = row.SkuId || row.ServiceName || "Usage";
      const key = `${name}:${row.ConsumedUnit}`;
      const previous = quantities.get(key);
      quantities.set(key, { name, unit: row.ConsumedUnit, used: (previous?.used ?? 0) + row.ConsumedQuantity });
    }
    return { provider: "Vercel", status: "connected", asOf: now.toISOString(), period: `${start.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)} (UTC)`,
      message: "Team-wide calendar-month charges, including other projects. Provider data is daily and may lag. Enter plan allowances in the provider record to track headroom; this amount is shown separately from manual costs.",
      ...(rows.length ? { cost: rows.reduce((sum, r) => sum + r.BilledCost, 0), currency: rows[0].BillingCurrency } : {}),
      metrics: [...quantities.values()].map((q) => ({ ...q, limit: null, behavior: "budget" })) };
  } catch (error) { return failed("Vercel", error); }
}

export async function getLiveUsage() {
  return Promise.all([vercelUsage(), resendUsage()]);
}
