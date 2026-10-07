/**
 * The payment plan — what a quote asks for, and when. Pure, so no database.
 *
 * - **It adds up to the price, exactly**, whatever the percentages or the
 *   phases round to — a lost cent is a job that can never be fully billed.
 * - **Split by scope, a phase bills what its rows are worth**, less its part of
 *   the deposit, and a row with no phase is billed in the last one.
 *
 *     npm run plan:check
 */

import {
  DEFAULT_TERMS,
  emptyDraft,
  makeNode,
  paymentPlan,
  paymentSchedule,
  phaseSections,
  type QuoteDraft,
  type QuoteTerms,
} from "@/lib/quote";

let failures = 0;
function is(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "FAIL  "} ${label}${ok ? "" : `\n        got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}

const sum = (draft: QuoteDraft) => paymentPlan(draft).reduce((total, payment) => total + payment.amountCents, 0);
const amounts = (draft: QuoteDraft) => paymentPlan(draft).map((payment) => payment.amountCents);

/** One priced row of `cents`, as a top-level group in `phaseKey`. */
function room(name: string, cents: number, phaseKey: string | null = null) {
  return makeNode("group", {
    description: name,
    phaseKey,
    children: [makeNode("item", { section: "labor", description: `${name} labor`, sellPriceCents: cents })],
  });
}

function draft(terms: Partial<QuoteTerms>, scope = [room("Whole job", 1_000_000)]): QuoteDraft {
  return emptyDraft({ scope, terms: { ...DEFAULT_TERMS, ...terms } });
}

/* 1 — by percent, the shop's pattern */
const pattern = [
  { key: "a", name: "Rough-in", percent: 50 },
  { key: "b", name: "Trim", percent: 30 },
  { key: "c", name: "Final", percent: 20 },
];
const byPercent = draft({ depositPercent: 30, moneyUpFront: "deposit", progressBilling: "draws", phases: pattern, phaseSplit: "percent" });
is("the deposit comes first, at its percentage", paymentPlan(byPercent)[0], {
  phaseKey: null, name: "Deposit", gate: "on_acceptance", amountCents: 300_000, workCents: null, rows: [],
});
is("the stages split what's left", amounts(byPercent), [300_000, 350_000, 210_000, 140_000]);
is("the last stage is the balance at the end", paymentPlan(byPercent)[3].gate, "on_completion");
is("…and the plan adds up", sum(byPercent), 1_000_000);

const awkward = draft(
  { depositPercent: 33, moneyUpFront: "deposit", progressBilling: "draws", phaseSplit: "percent",
    phases: [{ key: "a", name: "One", percent: 33 }, { key: "b", name: "Two", percent: 33 }, { key: "c", name: "Three", percent: 34 }] },
  [room("Odd", 100_001)]
);
is("it still adds up when the percentages don't divide", sum(awkward), 100_001);

/* 2 — no stages */
is("no deposit and no stages is one bill at the end", paymentPlan(draft({})).map((p) => [p.name, p.gate, p.amountCents]), [["Final balance", "on_completion", 1_000_000]]);
is("a deposit with no stages leaves the balance at the end", amounts(draft({ depositPercent: 25, moneyUpFront: "deposit" })), [250_000, 750_000]);
is("billing in stages with no phases is still one bill", amounts(draft({ progressBilling: "draws" })), [1_000_000]);
is("one payment is no schedule", paymentSchedule(draft({})), []);

/* 3 — by scope: a floor at a time */
const floors = [{ key: "f1", name: "First floor", percent: 0 }, { key: "f2", name: "Second floor", percent: 0 }];
const house = [room("Living room", 300_000, "f1"), room("Kitchen", 300_000, "f1"), room("Bedroom", 400_000, "f2")];
const noDeposit = draft({ progressBilling: "draws", phases: floors, phaseSplit: "scope" }, house);
is("each phase bills what its rows are worth", amounts(noDeposit), [600_000, 400_000]);
is("…and covers those rows", paymentPlan(noDeposit).map((p) => p.rows.map((r) => r.description)), [["Living room", "Kitchen"], ["Bedroom"]]);

const withDeposit = draft({ depositPercent: 30, moneyUpFront: "deposit", progressBilling: "draws", phases: floors, phaseSplit: "scope" }, house);
is("spread: every phase bills the same share of its work", amounts(withDeposit), [300_000, 420_000, 280_000]);
is("…the work is kept beside the bill", paymentPlan(withDeposit).map((p) => p.workCents), [null, 600_000, 400_000]);
is("…and it adds up", sum(withDeposit), 1_000_000);

const loose = draft({ progressBilling: "draws", phases: floors, phaseSplit: "scope" }, [...house, room("Hallway", 50_000)]);
is("a row with no phase is billed in the last one", amounts(loose), [600_000, 450_000]);
const gone = draft({ progressBilling: "draws", phases: floors, phaseSplit: "scope" }, [room("Den", 70_000, "deleted-phase"), ...house]);
is("…and so is a row naming a phase that's gone", amounts(gone), [600_000, 470_000]);

const taxed = emptyDraft({
  taxRate: 0.0825,
  terms: { ...DEFAULT_TERMS, progressBilling: "draws", phases: floors, phaseSplit: "scope" },
  scope: [
    makeNode("group", { description: "Paint 1", phaseKey: "f1", children: [makeNode("item", { section: "material", taxable: true, description: "Paint", sellPriceCents: 10_001 })] }),
    makeNode("group", { description: "Paint 2", phaseKey: "f2", children: [makeNode("item", { section: "material", taxable: true, description: "Paint", sellPriceCents: 10_001 })] }),
  ],
});
is("tax goes with the rows it's on, and the phases still add up", sum(taxed), Math.round(20_002 * 1.0825));

/* 4 — what she reads */
const sections = phaseSections(withDeposit);
is("a section per phase, named in order", sections.map((s) => s.heading), ["Phase 1 · First floor", "Phase 2 · Second floor"]);
is("…saying when it bills, and how much", sections.map((s) => [s.when, s.billedCents]), [["When this phase is done", 300_000 + 120_000], ["When the work's finished", 280_000]]);
is("…and what the deposit covered", sections[0].note, "Your deposit covers the other $1,800.");
is("by percent, the scope stays one list", phaseSections(byPercent), []);
is("the schedule starts with the deposit", paymentSchedule(withDeposit).map((p) => p.name), ["Deposit", "First floor", "Second floor"]);

/* Regression: independent rounding previously made the last bill negative. */
const pennyPlan = draft({ depositPercent: 99, moneyUpFront: "deposit", progressBilling: "draws", phaseSplit: "percent",
  phases: [33.33, 33.33, 33.33, 0.01].map((percent, i) => ({ key: String(i), name: `Phase ${i}`, percent })) }, [room("Small balance", 10_100)]);
is("fractional phase weights never produce a negative final bill", amounts(pennyPlan), [9_999, 34, 33, 34, 0]);
is("fractional weights preserve the exact agreed total", sum(pennyPlan), 10_100);
for (const split of ["percent", "scope"] as const) {
  let valid = true;
  for (let cents = 0; cents < 180; cents++) {
    for (const depositPercent of [0, 1, 33, 99, 100]) {
      const phases = Array.from({ length: 6 }, (_, i) => ({ key: String(i), name: `Phase ${i}`, percent: 1 }));
      const sample = draft({ depositPercent, moneyUpFront: "deposit", progressBilling: "draws", phaseSplit: split, phases },
        phases.map((phase, i) => room(phase.name, i === 5 ? 0 : cents, phase.key)));
      const plan = paymentPlan(sample);
      valid &&= plan.every(p => Number.isInteger(p.amountCents) && p.amountCents >= 0) && sum(sample) === cents * 5;
    }
  }
  is(`${split}: small balances, empty final phases, and deposits preserve nonnegative exact cents`, valid, true);
}

const tinyTaxed = emptyDraft({
  taxRate: 0.06,
  terms: { ...DEFAULT_TERMS, progressBilling: "draws", phaseSplit: "scope",
    phases: [0, 1, 2, 3].map(i => ({ key: String(i), name: `Phase ${i}`, percent: 25 })) },
  scope: [0, 1, 2].map(i => makeNode("group", { phaseKey: String(i), children: [
    makeNode("item", { section: "material", taxable: true, sellPriceCents: 9 }),
  ] })),
});
is("tax rounding stays on taxable work instead of making an empty final phase negative", amounts(tinyTaxed), [10, 9, 10, 0]);
is("taxed phases preserve the quote total", sum(tinyTaxed), 29);

console.log(failures ? `\n${failures} failed` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
