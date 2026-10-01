import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isAttachmentPath, receiptSchema } from "../lib/schemas/receipt.ts";
import { createInfoRequestSchema, validateInfoAnswers } from "../lib/schemas/info-request.ts";
import { validateInspectionResult } from "../lib/schemas/permit.ts";
import { passedInspectionPhases } from "../lib/field/inspection-gates.ts";

const prefix = "org/job/receipts";
assert.equal(isAttachmentPath(`${prefix}/file.png`, prefix), true);
for (const path of ["other/job/receipts/file.png", `${prefix}-other/file.png`, `${prefix}/../file.png`, `${prefix}/%2e%2e/file.png`, `${prefix}/folder/file.png`, `${prefix}/a\\file.png`]) {
  assert.equal(isAttachmentPath(path, prefix), false, path);
}
const receipt = { id: randomUUID(), vendor: "Supplier", description: "Parts", amountCents: 100, purchasedOn: "2026-09-15", storagePath: null };
assert.equal(receiptSchema.safeParse(receipt).success, true);
for (const amountCents of [-1, 0, 1.5, 2147483648]) assert.equal(receiptSchema.safeParse({ ...receipt, amountCents }).success, false);
assert.equal(receiptSchema.safeParse({ ...receipt, purchasedOn: "2026-02-30" }).success, false);
const question = { id: randomUUID(), prompt: "Where?" };
assert.equal(createInfoRequestSchema.safeParse({ id: randomUUID(), questions: [] }).success, false);
assert.equal(createInfoRequestSchema.safeParse({ id: randomUUID(), questions: [], photoPrompt: "Panel photo" }).success, true);
assert.equal(createInfoRequestSchema.safeParse({ id: randomUUID(), questions: [question, question] }).success, false);
assert.equal(validateInfoAnswers([question], [{ questionId: question.id, text: "Garage" }], null, []), null);
assert.ok(validateInfoAnswers([question], [{ questionId: randomUUID(), text: "Garage" }], null, []));
assert.ok(validateInfoAnswers([question], [{ questionId: question.id, text: "Garage" }, { questionId: question.id, text: "Garage" }], null, []));
assert.ok(validateInfoAnswers([], [], "Panel", []));
assert.ok(validateInfoAnswers([], [], null, ["photo"]));
assert.ok(validateInspectionResult({ result: "passed", completedOn: null, correctionsRequired: null }));
assert.ok(validateInspectionResult({ result: "failed", completedOn: "2026-09-15", correctionsRequired: "" }));
assert.equal(validateInspectionResult({ result: "failed", completedOn: "2026-09-15", correctionsRequired: "Fix wiring" }), null);
assert.deepEqual([...passedInspectionPhases([
  { clearsPhase: " Rough-in ", result: "failed" },
  { clearsPhase: "rough-in", result: "passed" },
])], []);
assert.deepEqual([...passedInspectionPhases([
  { clearsPhase: "Rough-in", result: "cancelled" },
  { clearsPhase: "rough-in", result: "passed" },
])], ["rough-in"]);
console.log("Field validation checks passed: amounts, dates, attachment boundaries, answers, inspection results and superseded inspections.");
