/**
 * The Scope tree's arithmetic, checked.
 *
 * **Four implementations have to agree about what a quote costs**:
 * `lib/quote/totals.ts` in the browser and on the server,
 * `lib/queries/scope-sql.ts` on the quotes list, the inlined walk in
 * `lib/queries/jobs.ts` on the job hub, and the projection the homeowner reads.
 * If any two disagree, the same quote shows one total in the editor and another
 * in the list — the single most trust-destroying bug this product can ship.
 *
 * This file pins the TypeScript side of that agreement: containers roll up
 * rather than store, optional rows stay out of the price and out of the margin,
 * tax lands on taxable non-labor rows, and the tree survives a round trip
 * through the flattened wire format unchanged.
 *
 *     npm run quote:check
 */

import {
  baseTotal, describeScope, dissolveNode, draftFromSeed, emptyDraft, flatten,
  insertNode, makeNode, margin, moveNode, moveTargets, nodeTotal, optionalTotal, parseSeed,
  retypeNode, shapeOf, toSavePayload, totals, buildTree, applyOfficeDefaults,
  idsByKey, withIds, customerLines, customerDetail, withCustomerDetail, overridesQuote, DEFAULT_TERMS,
  type ScopeNode,
} from "@/lib/quote";

let failures = 0;
function is(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "FAIL  "} ${label}${ok ? "" : `\n        got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}

/* 1 — an assembly rolls up from its children, and does not store its own price */
const assembly = makeNode("assembly", {
  description: "Recessed light — 6\" LED",
  quantity: 9,
  children: [
    makeNode("item", { section: "material", description: "Cans", quantity: 9, sellPriceCents: 3_400 }),
    makeNode("item", { section: "material", description: "Cable", quantity: 1, sellPriceCents: 11_700 }),
    makeNode("item", { section: "labor", description: "Cut-in", quantity: 10.8, sellPriceCents: 17_398 }),
  ],
});
is("assembly rolls up from children", nodeTotal(assembly), 3_400 * 9 + 11_700 + Math.round(10.8 * 17_398));
is("assembly stores no price of its own", assembly.sellPriceCents, 0);
is("assembly carries no cost bucket", assembly.section, null);

/* 2 — optional is inherited and held out of the base */
const group = makeNode("group", {
  description: "Service upgrade",
  children: [
    makeNode("item", { section: "material", description: "Panel", quantity: 1, sellPriceCents: 100_000 }),
    makeNode("item", { section: "labor", description: "Dryer circuit", quantity: 1, sellPriceCents: 34_000, optional: true }),
  ],
});
is("group subtotal excludes an optional child", baseTotal(group), 100_000);
is("group nodeTotal includes it", nodeTotal(group), 134_000);
is("optionalTotal finds it", optionalTotal(group), 34_000);

const optionalGroup = { ...group, optional: true };
is("an optional group holds everything out", baseTotal(optionalGroup), 0);
is("...and offers the whole subtree", optionalTotal(optionalGroup), 134_000);

/* 3 — totals: tax on taxable non-labor, optional excluded, containers not double-counted */
const draft = emptyDraft({
  taxRate: 0.06,
  scope: [group, makeNode("item", { section: "permit", description: "Permit", quantity: 1, sellPriceCents: 18_500 })],
});
const sums = totals(draft);
is("subtotal", sums.subtotalCents, 100_000 + 18_500);
is("optional stated separately", sums.optionalCents, 34_000);
is("tax skips labor and optional", sums.taxCents, Math.round((100_000 + 18_500) * 0.06));
is("total", sums.totalCents, 118_500 + Math.round(118_500 * 0.06));
is("buckets come from leaves", sums.bySection, { material: 100_000, labor: 0, equipment: 0, permit: 18_500 });

/* 4 — margin excludes optional rows */
const costed = emptyDraft({ scope: [
  makeNode("item", { section: "material", description: "A", quantity: 1, unitCostCents: 60_000, sellPriceCents: 100_000 }),
  makeNode("item", { section: "material", description: "B", quantity: 1, unitCostCents: 10_000, sellPriceCents: 34_000, optional: true }),
]});
is("margin ignores the optional row", margin(costed).marginPercent, 40);

/* 5 — flatten / rebuild round-trips the shape */
const payload = toSavePayload(draft);
is("flattened in document order", payload.scope.map((l) => l.description),
  ["Service upgrade", "Panel", "Dryer circuit", "Permit"]);
is("parents come before children", payload.scope.map((l) => l.parentIndex), [null, 0, 0, null]);
is("positions are document order", payload.scope.map((l) => l.position), [0, 1, 2, 3]);

const rebuilt = buildTree(
  payload.scope.map((l, i) => ({
    ...l,
    id: `row-${i}`,
    parentId: l.parentIndex === null ? null : `row-${l.parentIndex}`,
  })),
  (row) => ({ ...(row as unknown as ScopeNode), type: row.nodeType, key: row.id, children: [] })
);
is("rebuilds the same shape", flatten(rebuilt).map((f) => f.node.description),
  ["Service upgrade", "Panel", "Dryer circuit", "Permit"]);
is("rebuilds the same totals", totals({ ...draft, scope: rebuilt }).totalCents, sums.totalCents);

/* 6 — depth is not capped: a fourth level lands where it was asked */
const deep = insertNode([makeNode("group", { description: "L0" })], makeNode("group", { description: "L1" }), null);
const g0 = deep[0].key;
let tree = insertNode(deep, makeNode("assembly", { description: "Walls" }), g0);
const g1 = tree[0].children[0].key;
tree = insertNode(tree, makeNode("assembly", { description: "Materials" }), g1);
const g2 = tree[0].children[0].children[0].key;
tree = insertNode(tree, makeNode("item", { section: "material", description: "Paint" }), g2);
is("a row inside a third-level assembly stays inside it", tree[0].children[0].children[0].children.length, 1);
is("…and nothing lands at the root", tree.length, 2);
is("Move to offers the deep assembly", moveTargets(tree, deep[1].key).some((target) => target.key === g2), true);

/* 7 — retype drops money when a row stops being priced */
const priced = makeNode("item", { section: "labor", description: "note-to-be", sellPriceCents: 5_000, unitCostCents: 3_000 });
const asNote = retypeNode(priced, "note");
is("retyped to note: no bucket", asNote.section, null);
is("retyped to note: no price", asNote.sellPriceCents, 0);
is("retyped to note: no cost", asNote.unitCostCents, null);
is("retyped keeps its words", asNote.description, "note-to-be");

/* 8 — break apart keeps the rows and pushes optional down */
const bundle = makeNode("assembly", { description: "Bundle", optional: true, children: [
  makeNode("item", { section: "material", description: "part" }),
]});
const loose = dissolveNode([bundle], bundle.key);
is("break apart keeps the child", loose.map((n) => n.description), ["part"]);
is("...and it stays optional", loose[0].optional, true);

/* 9 — reorder is sibling-only */
const a = makeNode("item", { section: "material", description: "a" });
const b = makeNode("item", { section: "material", description: "b" });
const holder = makeNode("group", { description: "g", children: [a, b] });
is("moves a child among its siblings",
  moveNode([holder], b.key, -1)[0].children.map((n) => n.description), ["b", "a"]);
is("refuses to move past the end",
  moveNode([holder], a.key, -1)[0].children.map((n) => n.description), ["a", "b"]);

/* 10 — a typed sentence names the quote and invents nothing */
const seeded = draftFromSeed(parseSeed("Dana Reyes — the dead outlet"));
is("seed fills the customer", seeded.customerName, "Dana Reyes");
is("seed fills the title, without the article", seeded.title, "Dead outlet");
is("seed adds no rows", shapeOf(seeded.scope).nodes, 0);
is("seed writes no scope paragraph", seeded.scopeOfWork, "");
is("an empty scope says so", describeScope(seeded.scope), "Empty");
is("an empty quote totals zero", totals(seeded).totalCents, 0);

/* 11 — empty rows are pruned, containers holding real rows survive */
const withBlank = emptyDraft({ scope: [
  makeNode("group", { description: "", children: [makeNode("item", { section: "material", description: "real", sellPriceCents: 100 })] }),
  makeNode("item", { section: "material", description: "" }),
]});
is("a blank leaf is not persisted", toSavePayload(withBlank).scope.map((l) => l.description), ["", "real"]);

/* 12 — the Office's starting values fill gaps and never overwrite decisions */
const SHOP_DEFAULTS = {
  depositPercent: 25,
  materialMarkupPercent: 32,
  laborRateCents: 11_400,
  taxRate: "0.0825",
  standardExclusions: [
    "Drywall repair and paint",
    "Fixtures supplied by the owner",
  ].join("\n"),
  standardAssumptions: "Power can be shut off during work",
};

const bare = applyOfficeDefaults(emptyDraft(), SHOP_DEFAULTS);
is("defaults supply a tax rate", bare.taxRate, 0.0825);
is("defaults supply a deposit", bare.terms.depositPercent, 25);
// A percentage with the switch left off is a deposit the editor shows and the
// terms sheet says isn't there.
is("...and switch it on", bare.terms.moneyUpFront, "deposit");
is(
  "standard wording becomes rows, one per line",
  bare.scope.map((n) => `${n.type}:${n.description}`),
  [
    "exclusion:Drywall repair and paint",
    "exclusion:Fixtures supplied by the owner",
    "assumption:Power can be shut off during work",
  ]
);

// A new quote asks for no deposit until someone chooses one — no share of the
// customer's money is picked on the contractor's behalf.
is(
  "a new quote starts with no deposit",
  [emptyDraft().terms.moneyUpFront, emptyDraft().terms.depositPercent],
  ["none", null]
);

// An Office that has set nothing leaves it that way.
const unset = applyOfficeDefaults(emptyDraft(), {
  ...SHOP_DEFAULTS,
  depositPercent: null,
  taxRate: null,
});
is(
  "an unset default invents no deposit",
  [unset.terms.moneyUpFront, unset.terms.depositPercent],
  ["none", null]
);
is("...and leaves the tax rate null", unset.taxRate, null);

// A duplicated quote carries the exclusions it was written with; appending the
// Office's would double them.
const dup = applyOfficeDefaults(
  emptyDraft({ scope: [makeNode("exclusion", { description: "Its own" })] }),
  SHOP_DEFAULTS
);
is("existing wording is left alone", dup.scope.map((n) => n.description), ["Its own"]);

/* — what the customer sees: one total, the top-level rows, or every row, overridable per group */
{
  const walls = makeNode("item", { section: "labor", description: "Walls", sellPriceCents: 30_000 });
  const ceiling = makeNode("item", { section: "labor", description: "Ceiling", sellPriceCents: 20_000 });
  const extra = makeNode("item", { section: "labor", description: "Closet", sellPriceCents: 9_000, optional: true });
  const note = makeNode("note", { description: "Owner moves furniture" });
  const bedroom = makeNode("group", { description: "Master bedroom", children: [walls, ceiling, extra, note] });
  const permit = makeNode("item", { section: "permit", description: "Permit", sellPriceCents: 5_000 });
  const scope = [bedroom, permit];
  const shown = (lines: ReturnType<typeof customerLines>) =>
    lines.map((l) => `${"  ".repeat(l.depth)}${l.node.description} ${l.amountCents}`);

  is("top-level rows: a group is one line", shown(customerLines(scope, "top")), [
    "Master bedroom 50000", "Permit 5000",
  ]);
  is("every row: the group's rows under it, optional and notes left out", shown(customerLines(scope, "all")), [
    "Master bedroom 50000", "  Walls 30000", "  Ceiling 20000", "Permit 5000",
  ]);
  is("one total: no rows", customerLines(scope, "total").length, 0);

  const showing = [{ ...bedroom, breakdown: "show" as const }, permit];
  is("a group can show its rows on a top-level quote", shown(customerLines(showing, "top")).length, 4);
  is("…and is marked as differing from the quote", overridesQuote(showing[0], "top"), true);
  const hiding = [{ ...bedroom, breakdown: "hide" as const }, permit];
  is("a group can stay one line on an every-row quote", shown(customerLines(hiding, "all")), [
    "Master bedroom 50000", "Permit 5000",
  ]);
  is("an override that matches the quote isn't flagged", overridesQuote(showing[0], "all"), false);

  is("one total ↔ single-total price structure", customerDetail(withCustomerDetail(DEFAULT_TERMS, "total")), "total");
  is("back to every row restores itemised", withCustomerDetail(withCustomerDetail(DEFAULT_TERMS, "total"), "all").priceStructure, "itemized");

  const saved = toSavePayload(emptyDraft({ scope: showing })).scope;
  is("a group's choice is saved", saved[0].breakdown, "show");
  is("rows that aren't groups never carry one", saved.slice(1).every((row) => row.breakdown === null), true);
  is("retyping a group to a line drops it", retypeNode(makeNode("group", { breakdown: "show" }), "item").breakdown, null);
}

/* — autosave: ids come back by key, so rows added while a save is out keep their own */
{
  const a = makeNode("item", { description: "A", sellPriceCents: 100, id: "id-a" });
  const b = makeNode("item", { description: "B", sellPriceCents: 200, id: "id-b" });
  const c = makeNode("item", { description: "C", sellPriceCents: 300 });
  const sent = [a, b, c];
  // The server echoes the rows in the order sent, giving C its new id.
  const returned = [{ ...a }, { ...b }, { ...c, id: "id-c" }];
  const ids = idsByKey(sent, returned);

  // While that save was out, N was typed in above B, and B was moved into a group.
  const n = makeNode("item", { description: "N", sellPriceCents: 999 });
  const g = makeNode("group", { description: "G", children: [b] });
  const live = withIds([a, n, c, g], ids);
  const next = toSavePayload(emptyDraft({ scope: live })).scope;

  is("each row keeps its own id", next.map((row) => `${row.description}:${row.id}`), [
    "A:id-a", "N:null", "C:id-c", "G:null", "B:id-b",
  ]);
  const sentIds = next.map((row) => row.id).filter(Boolean);
  is("no id is sent twice", sentIds.length, new Set(sentIds).size);
  is("a mismatched echo adopts nothing", idsByKey(sent, returned.slice(1)).size, 0);
  is("blank rows are skipped on both sides", idsByKey([a, makeNode("item"), b], [{ ...a }, { ...b }]).get(b.key), "id-b");
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
