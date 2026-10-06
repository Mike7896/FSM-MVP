import assert from "node:assert/strict";
import { runPlanTransition, sameConfig, type PlanTransition, type TransitionPorts, type TransitionSnapshot } from "../lib/membership/transition";
import { purchaseQuery, signupDestination, validatedSignupDestination } from "../lib/membership/purchase-intent";
import { visibleQuoteStatus } from "../lib/membership/quote-visibility";

let passed = 0;
function check(label: string) { console.log(`ok ${++passed}: ${label}`); }
const starter = { tier: "starter", interval: "month", packs: [] } as const;
function initial(): PlanTransition {
  return {
    id: "transition-test", subscriptionId: "sub_test", target: { tier: "pro", interval: "year", packs: [] },
    immediate: { tier: "pro", interval: "month", packs: [] }, scheduled: { tier: "pro", interval: "year", packs: [] },
    previous: { tier: "starter", interval: "year", packs: [] }, previousCancel: false,
    founding: false, prorationDate: 1000, periodEnd: 100000, update: { items: [{ price: "pro" }] },
    phase: "prepared", invoiceUrl: null,
  };
}

function fixture(fault = -1, pending = false) {
  let durable = initial();
  if (pending) durable.previous = null;
  let step = 0;
  let charges = 0;
  let failAt = fault;
  let now = 1100;
  const keys = new Set<string>();
  const snapshot: TransitionSnapshot = { config: { ...starter, packs: [] }, pending: false, ended: false, scheduleId: pending ? null : "old", invoiceUrl: null };
  let renewal = durable.previous;
  const hit = () => { if (step++ === failAt) { failAt = -1; throw new Error("Interrupted"); } };
  const ports: TransitionPorts = {
    save: async state => { hit(); durable = structuredClone(state); hit(); },
    read: async () => { hit(); const result = structuredClone(snapshot); hit(); return result; },
    release: async () => { hit(); snapshot.scheduleId = null; renewal = null; hit(); },
    update: async (_params, key) => {
      hit();
      if (!keys.has(key)) {
        keys.add(key); charges++;
        snapshot.pending = pending;
        if (!pending) snapshot.config = structuredClone(durable.immediate!);
        snapshot.invoiceUrl = "https://invoice.invalid/test";
      }
      hit();
    },
    schedule: async config => { hit(); renewal = structuredClone(config); snapshot.scheduleId = "replacement"; hit(); },
    cancelAtEnd: async () => { hit(); hit(); },
    now: () => now,
  };
  return { ports, snapshot, get durable() { return durable; }, get charges() { return charges; },
    get renewal() { return renewal; }, get steps() { return step; }, setNow(value: number) { now = value; } };
}

const baseline = fixture();
await runPlanTransition(baseline.durable, baseline.ports);
assert.equal(baseline.durable.phase, "complete");
for (let fault = 0; fault < baseline.steps; fault++) {
  const test = fixture(fault);
  try { await runPlanTransition(test.durable, test.ports); } catch { /* simulated interruption */ }
  await runPlanTransition(test.durable, test.ports);
  assert.equal(test.durable.phase, "complete", `fault ${fault}`);
  assert.equal(test.charges, 1, `duplicate charge at fault ${fault}`);
  assert.deepEqual(test.renewal, initial().target, `lost target at fault ${fault}`);
}
check(`recovery before/after all ${baseline.steps} successful-path checkpoints retains target and charges once`);

const waitingBaseline = fixture(-1, true);
await runPlanTransition(waitingBaseline.durable, waitingBaseline.ports);
for (let fault = 0; fault < waitingBaseline.steps; fault++) {
  const test = fixture(fault, true);
  try { await runPlanTransition(test.durable, test.ports); } catch { /* simulated interruption */ }
  await runPlanTransition(test.durable, test.ports);
  assert.equal(test.durable.phase, "waiting");
  assert.equal(test.renewal, null);
  test.snapshot.pending = false;
  test.snapshot.config = initial().immediate!;
  await runPlanTransition(test.durable, test.ports);
  assert.equal(test.durable.phase, "complete");
  assert.equal(test.charges, 1);
  assert.deepEqual(test.renewal, initial().target);
}
check(`all ${waitingBaseline.steps} pending-payment interruption points apply the saved renewal after payment`);

const expired = fixture(-1, true);
await runPlanTransition(expired.durable, expired.ports);
expired.snapshot.pending = false;
await runPlanTransition(expired.durable, expired.ports);
assert.equal(expired.durable.phase, "aborted");
assert.equal(expired.renewal, null);
assert.equal(expired.charges, 1);
check("expired pending payment ends the command without charging again");

const declined = fixture();
declined.ports.update = async () => { throw Object.assign(new Error("Declined"), { type: "StripeCardError" }); };
await assert.rejects(() => runPlanTransition(declined.durable, declined.ports), /Declined/);
assert.equal(declined.durable.phase, "aborted");
assert.deepEqual(declined.renewal, initial().previous);
check("a declined upgrade with an existing renewal choice restores it and ends the command");

const stale = fixture();
stale.setNow(1000 + 23 * 3600);
await runPlanTransition(stale.durable, stale.ports);
assert.equal(stale.charges, 0);
assert.equal(stale.durable.phase, "aborted");
check("stale unpaid instruction cannot create a new charge beyond the idempotency window");

const overdue = fixture();
overdue.setNow(100000);
await assert.rejects(() => runPlanTransition(overdue.durable, overdue.ports), /support review/);
assert.equal(overdue.charges, 0);
assert.deepEqual(overdue.renewal, initial().previous);
check("recovery past the original renewal requests review instead of silently moving it a period later");

const downgrade = fixture();
const scheduleOnly = { ...initial(), immediate: null, scheduled: initial().previous, target: initial().previous! };
await runPlanTransition(scheduleOnly, downgrade.ports);
assert.equal(downgrade.charges, 0);
assert.equal(downgrade.durable.phase, "complete");
check("schedule-only changes do not release the old schedule or charge immediately");

const completed = fixture();
await runPlanTransition({ ...initial(), phase: "complete" }, completed.ports);
assert.equal(completed.steps, 0);
await runPlanTransition({ ...initial(), phase: "aborted" }, completed.ports);
assert.equal(completed.steps, 0);
check("completed and canceled commands never replay side effects");

assert.equal(purchaseQuery({ plan: "pro", interval: "year", pack: "electrical" }), "plan=pro&interval=year&pack=electrical");
assert.equal(signupDestination({ plan: "starter", trade: "electrician" }), "/welcome?plan=starter&interval=month&trade=electrician");
assert.equal(validatedSignupDestination("/welcome?plan=pro&interval=year&pack=electrical"), "/welcome?plan=pro&interval=year&pack=electrical");
for (const bad of ["https://evil.invalid", "//evil.invalid", "/welcome/../../evil", "/welcome?next=https://evil.invalid", "/welcomex"]) {
  assert.equal(validatedSignupDestination(bad), "/welcome");
}
assert.equal(purchaseQuery({ plan: ["pro", "starter"] }), null);
assert.equal(purchaseQuery({ plan: "admin" }), null);
check("purchase intent preserves validated choices through auth and refuses injected destinations/tiers");

assert.equal(visibleQuoteStatus("viewed", false), "sent");
assert.equal(visibleQuoteStatus("viewed", true), "viewed");
for (const status of ["draft", "accepted", "declined", "sent"]) assert.equal(visibleQuoteStatus(status, false), status);
assert.ok(sameConfig(initial().target, { ...initial().target }));
check("redacting views preserves ordinary workflow status");
console.log(`${passed} checks passed`);
