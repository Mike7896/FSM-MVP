/**
 * Saved items, checked: the formula language, settings resolving job-first,
 * and a saved item expanding into ordinary Scope rows.
 *
 * The item built here is a test fixture for the engine, not Library content —
 * nothing in this file reaches a screen.
 *
 *     npm run library:check
 */

import {
  describeSavedItem,
  evaluateFormula,
  expandSavedItem,
  fillTemplate,
  parseFormula,
  resolveSettings,
  templateFromNode,
  type SettingDef,
  type TemplateNode,
} from "@/lib/library";
import { savedItemIssues } from "@/lib/schemas/library";
import { allNodes, makeNode, nodeTotal } from "@/lib/quote";

let failures = 0;
function is(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "FAIL  "} ${label}${ok ? "" : `\n        got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}
function throws(label: string, run: () => unknown) {
  let threw = false;
  try {
    run();
  } catch {
    threw = true;
  }
  if (!threw) failures++;
  console.log(`${threw ? "  ok  " : "FAIL  "} ${label}`);
}

const run = (source: string, scope: Record<string, number | string | boolean> = {}) =>
  evaluateFormula(parseFormula(source), scope);

/* 1 — the formula language */
is("precedence", run("2 + 3 * 4"), 14);
is("parentheses", run("(2 + 3) * 4"), 20);
is("unary minus", run("-2 * -3"), 6);
is("names", run("a * b", { a: 3, b: 4 }), 12);
is("ceil", run("ceil(w * h / 144)", { w: 36, h: 48 }), 12);
is("round to places", run("round(10 / 3, 2)"), 3.33);
is("min / max", run("max(1, min(5, 3), 2)"), 3);
is("string equality", run("style == 'french'", { style: "french" }), true);
is("word operators", run("a > 1 and not b", { a: 2, b: false }), true);
is("ternary", run("style == \"french\" ? 2 : 1", { style: "single" }), 1);
is("string join", run("'a' + 'b'"), "ab");
throws("unknown setting", () => run("nope + 1"));
throws("unknown function", () => run("exec(1)"));
throws("division by zero", () => run("1 / 0"));
throws("trailing junk", () => parseFormula("1 2"));
throws("no code execution", () => parseFormula("constructor.constructor('x')()"));
is("sentence fill", fillTemplate("Window {w} × {h}", { w: 36, h: 48 }), "Window 36 × 48");
is("sentence fill computes", fillTemplate("{w * 2} in", { w: 1.5 }), "3 in");

/* 2 — settings resolve job-first, then defaults */
const settings: SettingDef[] = [
  { kind: "number", key: "width", label: "Width", unit: "in", min: 1, max: 200 },
  { kind: "number", key: "height", label: "Height", unit: "in", min: 1, max: 200 },
  {
    kind: "choice",
    key: "style",
    label: "Style",
    choices: [
      { value: "single", label: "Single" },
      { value: "pair", label: "Pair" },
    ],
  },
];
const defaults = { width: 36, height: 48, style: "single" };

const fromDefaults = resolveSettings(settings, defaults);
is("defaults used when the job has none", fromDefaults.values, defaults);
is("…and marked as defaults", fromDefaults.from, { width: "default", height: "default", style: "default" });

const withJob = resolveSettings(settings, defaults, { height: 60 });
is("a job setting overrides its default", withJob.values, { width: 36, height: 60, style: "single" });
is("…only for that setting", withJob.from, { width: "default", height: "job", style: "default" });

const badJob = resolveSettings(settings, defaults, { width: 999, style: "gone" });
is("a job value that no longer fits falls back", badJob.values, defaults);

const noDefault = resolveSettings(settings, { width: 36 });
is("a setting with no value anywhere is unset", noDefault.from.height, null);

/* 3 — expanding a saved item into Scope rows */
const template: TemplateNode = {
  type: "assembly",
  description: "Window",
  section: null,
  quantity: 1,
  unit: null,
  unitCostCents: null,
  markupPercent: null,
  sellPriceCents: 0,
  taxable: false,
  optional: false,
  formulas: { description: "Window {width} × {height}" },
  children: [
    {
      type: "item",
      description: "Unit",
      section: "material",
      quantity: 1,
      unit: "ea",
      unitCostCents: 10_000,
      markupPercent: 50,
      sellPriceCents: 15_000,
      taxable: true,
      optional: false,
      children: [],
      formulas: { quantity: "style == 'pair' ? 2 : 1", unitCostCents: "width * height * 5" },
    },
    {
      type: "item",
      description: "Trim",
      section: "material",
      quantity: 1,
      unit: "ft",
      unitCostCents: null,
      markupPercent: null,
      sellPriceCents: 300,
      taxable: true,
      optional: false,
      children: [],
      formulas: { quantity: "ceil((width + height) * 2 / 12)" },
    },
    {
      type: "item",
      description: "Mullion",
      section: "material",
      quantity: 1,
      unit: "ea",
      unitCostCents: null,
      markupPercent: null,
      sellPriceCents: 4_000,
      taxable: true,
      optional: false,
      children: [],
      when: "style == 'pair'",
    },
  ],
};
const item = { template, source: "shop" as const };

const placed = expandSavedItem(item, fromDefaults.values);
const [unit, trim] = placed.node.children;
is("no problems at the defaults", placed.problems, []);
is("description filled from settings", placed.node.description, "Window 36 × 48");
is("quantity formula", unit.quantity, 1);
is("cost formula", unit.unitCostCents, 36 * 48 * 5);
is("cost + markup prices the row", unit.sellPriceCents, Math.round(36 * 48 * 5 * 1.5));
is("ceil formula", trim.quantity, Math.ceil(((36 + 48) * 2) / 12));
is("a row whose condition fails is left out", placed.node.children.length, 2);
is("rows are the shop's own numbers", unit.source, "typed");
is("every row is new", allNodes([placed.node]).every((node) => node.id === null && node.key.startsWith("new-")), true);

const pair = expandSavedItem(item, { ...fromDefaults.values, style: "pair" });
is("a row whose condition holds is placed", pair.node.children.map((node) => node.description), ["Unit", "Trim", "Mullion"]);
is("…and the quantity follows the choice", pair.node.children[0].quantity, 2);

const twice = [expandSavedItem(item, defaults).node, expandSavedItem(item, defaults).node];
is("two drops never share keys", twice[0].key !== twice[1].key, true);

const missing = expandSavedItem(item, { width: 36, style: "single" });
is("a formula with an unset setting keeps the saved number", missing.node.children[0].unitCostCents, 10_000);
is("…and says so", missing.problems.length > 0, true);

is("pack rows are marked as a starting number", expandSavedItem({ template, source: "pack" }, defaults).node.children[0].source, "template");

is("summary lists the settings", describeSavedItem({ template, settings, summary: null, source: "shop" }, defaults), "36 in · 48 in · Single");
is("summary uses its own sentence", describeSavedItem({ template, settings, summary: "{width} × {height} in · {style}", source: "shop" }, defaults), "36 × 48 in · single");

/* 4 — saving a Scope row */
const group = makeNode("group", {
  description: "Bedroom",
  children: [
    makeNode("item", { section: "labor", description: "Walls", quantity: 4, sellPriceCents: 5_000 }),
    makeNode("note", { description: "Furniture moved by owner" }),
  ],
});
const saved = templateFromNode({ ...group, id: "00000000-0000-0000-0000-000000000000" });
is("saving drops identity", "key" in saved || "id" in saved, false);
const replaced = expandSavedItem({ template: saved, source: "shop" }, {});
is("a plain saved row places back unchanged", nodeTotal(replaced.node), nodeTotal(group));
is("…keeping its rows in order", replaced.node.children.map((node) => node.type), ["item", "note"]);
is("plain summary", describeSavedItem({ template: saved, settings: [], summary: null, source: "shop" }, {}), "Group · 1 row · $200");

/* 5 — what a save refuses */
is("a valid item has no issues", savedItemIssues({ template, settings, defaults, summary: null }), []);
is("formula naming a missing setting", savedItemIssues({ template, settings: settings.slice(0, 1), defaults: { width: 36 }, summary: null }).length > 0, true);
is("default outside its setting", savedItemIssues({ template: saved, settings, defaults: { width: 500 }, summary: null }).length, 1);
is("default with no setting", savedItemIssues({ template: saved, settings: [], defaults: { width: 36 }, summary: null }).length, 1);
is("broken formula", savedItemIssues({ template: { ...saved, formulas: { quantity: "1 +" } }, settings: [], defaults: {}, summary: null }).length, 1);
is("a deep item is fine", savedItemIssues({
  template: { ...saved, children: [{ ...saved, type: "group", children: [{ ...saved, type: "group", children: [templateFromNode(makeNode("item"))] }] }] },
  settings: [], defaults: {}, summary: null,
}), []);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
