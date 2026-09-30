import assert from "node:assert/strict";
import { getLiveUsage } from "../lib/admin/usage-providers";

async function main() {
  const originalFetch = globalThis.fetch;
  // Process-local fixtures. Never contact a provider with test credentials.
  process.env.VERCEL_USAGE_API_TOKEN = "fixture";
  process.env.VERCEL_USAGE_TEAM_ID = "fixture-team";
  process.env.RESEND_USAGE_API_KEY = "fixture";
  try {
    globalThis.fetch = async (url) => {
      if (String(url).startsWith("https://api.resend.com/usage")) return Response.json({ emails: {
        daily: { used: 2, limit: null, resets_at: "2026-10-01T00:00:00Z" },
        monthly: { used: 99, limit: 100, resets_at: "2026-10-01T00:00:00Z" },
      } });
      assert(String(url).includes("teamId=fixture-team"));
      return new Response([
        { BilledCost: "10.50", BillingCurrency: "USD", SkuId: "cpu", ConsumedQuantity: 2, ConsumedUnit: "hours" },
        { BilledCost: -1, BillingCurrency: "USD", SkuId: "cpu", ConsumedQuantity: 3, ConsumedUnit: "hours" },
        { BilledCost: 5, BillingCurrency: "USD", SkuId: "cpu", ConsumedQuantity: 20, ConsumedUnit: "seconds" },
      ].map(r => JSON.stringify(r)).join("\n"));
    };
    const [vercel, resend] = await getLiveUsage();
    assert.equal(vercel.cost, 14.5);
    assert.equal(vercel.metrics.length, 2, "Do not combine unlike units");
    assert.equal(vercel.metrics[0].used, 5);
    assert.equal(resend.metrics[0].limit, null, "Unlimited stays distinct from zero");
    assert.equal(resend.metrics[1].used, 99);
    globalThis.fetch = async (url) => String(url).includes("resend.com") ? new Response("", {status:401}) : new Response("not json");
    const errors = await getLiveUsage();
    assert(errors.every(r => r.status === "error" && r.metrics.length === 0));
    assert(errors[1].message.includes("permissions"));
    delete process.env.VERCEL_USAGE_API_TOKEN;
    delete process.env.VERCEL_USAGE_TEAM_ID;
    delete process.env.RESEND_USAGE_API_KEY;
    delete process.env.RESEND_API_KEY;
    globalThis.fetch = async () => { throw new Error("Unconfigured providers must not fetch"); };
    assert((await getLiveUsage()).every(r => r.status === "setup"));
    console.log("Provider checks passed: JSONL aggregation, credits, units, quota nulls, missing credentials and isolated failures.");
  } finally { globalThis.fetch = originalFetch; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
