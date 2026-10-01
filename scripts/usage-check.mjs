import assert from "node:assert/strict";
import { headroom, defaultProviders, providerUsageSchema } from "../lib/admin/usage-model.ts";

assert.equal(headroom(null, 100), null);
assert.equal(headroom(10, null), null);
assert.deepEqual(headroom(20, 100), { remaining: 80, excess: 0, percent: 20 });
assert.deepEqual(headroom(120, 100), { remaining: 0, excess: 20, percent: 120 });
assert.deepEqual(headroom(1, 0), { remaining: 0, excess: 1, percent: 100 });
assert.deepEqual(headroom(0, 0), { remaining: 0, excess: 0, percent: 0 });
const defaults = defaultProviders(new Date("2026-09-15T12:00:00Z"));
assert(defaults.every(p => p.reported === null && p.recurring === null && p.updatedAt === null));
assert(defaults.every(p => p.metrics.every(m => m.used === null && m.limit === null)));
assert.equal(defaults[0].end, "2026-10-01");
assert.equal(defaultProviders(new Date("2026-12-31T00:00:00Z"))[0].end, "2027-01-01");
const record = { ...defaults[0], start: "2026-01-01", end: "2026-02-01", asOf: "2026-01-15" };
assert(providerUsageSchema.safeParse(record).success);
for (const patch of [{reported:-1}, {recurring:Infinity}, {start:"invalid"}, {end:record.start}, {asOf:"2026-02-01"}, {asOf:"2099-01-01"}, {id:"../../oops"}, {currency:"XYZ"}, {metrics:[{name:"", unit:"GB", used:0, limit:1, behavior:"hard"}]}]) {
  assert.equal(providerUsageSchema.safeParse({...record, ...patch}).success, false, JSON.stringify(patch));
}
console.log("Usage checks passed: unknown values, headroom, zero limits, overages, dates, validation and empty defaults.");
