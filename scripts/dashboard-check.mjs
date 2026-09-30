import assert from "node:assert/strict";
import { dashboardDate, dashboardHorizon, quoteFollowUp } from "../lib/dashboard.ts";

// A late-night visit belongs to the contractor's day, not the UTC date.
assert.equal(dashboardDate(new Date("2026-10-01T02:30:00Z"), "America/New_York"), "2026-09-30");
assert.equal(dashboardDate(new Date("2026-09-30T20:00:00Z"), "Asia/Tokyo"), "2026-10-01");
// Both occurrences of the repeated hour during the DST change stay on Sunday.
assert.equal(dashboardDate(new Date("2026-11-01T05:30:00Z"), "America/New_York"), "2026-11-01");
assert.equal(dashboardDate(new Date("2026-11-01T06:30:00Z"), "America/New_York"), "2026-11-01");
assert.equal(dashboardHorizon("2026-12-29"), "2027-01-04");
assert.equal(dashboardHorizon("2028-02-26"), "2028-03-03");

const now = Date.parse("2026-09-30T12:00:00Z");
const old = new Date("2026-09-20T12:00:00Z");
const recent = new Date("2026-09-30T10:00:00Z");
assert.equal(quoteFollowUp(recent, null, true, now), false);
assert.equal(quoteFollowUp(old, recent, true, now), false);
assert.equal(quoteFollowUp(old, recent, false, now), true, "Hidden view tracking must not affect the suggested action");
assert.equal(quoteFollowUp(new Date(now - 3 * 86_400_000), null, true, now), true);
assert.equal(quoteFollowUp(new Date(now - 3 * 86_400_000 + 1), null, true, now), false);
assert.equal(quoteFollowUp(null, null, false, now), false);
assert.equal(quoteFollowUp(new Date(now + 1000), null, true, now), false);
console.log("13 dashboard date and follow-up checks passed.");
