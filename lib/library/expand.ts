/**
 * Turning a saved item into Scope rows, and a Scope row into a saved item.
 *
 * What lands in Scope is ordinary rows: fresh keys, no link back to the
 * Library, edited exactly like rows typed by hand. Changing a saved item later
 * never reaches a quote it was already dropped into.
 */

import {
  NODE_SPEC,
  formatMoney,
  makeNode,
  nodeTotal,
  sellFromCost,
  type LineSource,
  type ScopeNode,
} from "@/lib/quote";

import {
  fillTemplate,
  formulaNumber,
  formulaTruthy,
  parseFormula,
  type FormulaValue,
} from "./formula";
import type {
  SavedItem,
  SettingDef,
  SettingValue,
  SettingValues,
  TemplateNode,
} from "./types";

/* ── Settings ─────────────────────────────────────────────────────────── */

export function isValidSetting(def: SettingDef, value: unknown): value is SettingValue {
  if (def.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (def.min !== null && value < def.min) return false;
    if (def.max !== null && value > def.max) return false;
    return true;
  }
  return typeof value === "string" && def.choices.some((choice) => choice.value === value);
}

export type ResolvedSettings = {
  values: SettingValues;
  /** Where each value came from. Null: neither the job nor the defaults have one. */
  from: Record<string, "job" | "default" | null>;
};

/**
 * The settings a drop uses: **the job's own where it has one, the Office's
 * default where it doesn't.** A value that no longer fits its setting — a
 * choice since removed, a number outside a new limit — is passed over as if it
 * weren't set.
 */
export function resolveSettings(
  settings: SettingDef[],
  defaults: SettingValues,
  job?: SettingValues | null
): ResolvedSettings {
  const values: SettingValues = {};
  const from: ResolvedSettings["from"] = {};

  for (const def of settings) {
    const own = job?.[def.key];
    const fallback = defaults[def.key];
    if (isValidSetting(def, own)) {
      values[def.key] = own;
      from[def.key] = "job";
    } else if (isValidSetting(def, fallback)) {
      values[def.key] = fallback;
      from[def.key] = "default";
    } else {
      from[def.key] = null;
    }
  }

  return { values, from };
}

/** `36 in`, `Double hung`. */
export function formatSetting(def: SettingDef, value: SettingValue | undefined): string {
  if (value === undefined) return "Not set";
  if (def.kind === "choice") {
    return def.choices.find((choice) => choice.value === value)?.label ?? String(value);
  }
  const amount = String(Math.round(Number(value) * 1000) / 1000);
  return def.unit ? `${amount} ${def.unit}` : amount;
}

/* ── Placing ──────────────────────────────────────────────────────────── */

export type Expansion = {
  node: ScopeNode;
  /** Formulas that couldn't be worked out, where the saved number was used instead. */
  problems: string[];
};

/**
 * One saved item as a Scope node, sized by `values`.
 *
 * A formula that fails — a setting with no value, a division by zero — leaves
 * the row's saved number in place and is reported, rather than dropping the row
 * or writing a zero nobody chose. A row whose `when` doesn't hold is left out,
 * along with everything inside it.
 */
export function expandSavedItem(
  item: Pick<SavedItem, "template" | "source">,
  values: SettingValues
): Expansion {
  const problems: string[] = [];
  const scope: Record<string, FormulaValue> = values;
  // A shop's own item carries the shop's own numbers. A pack's are a starting
  // point, and the row says so until the contractor changes it.
  const source: LineSource = item.source === "pack" ? "template" : "typed";

  function compute<T>(label: string, formula: string | undefined, run: (source: string) => T): T | undefined {
    if (!formula) return undefined;
    try {
      return run(formula);
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : "couldn't be worked out"}`);
      return undefined;
    }
  }

  function build(template: TemplateNode): ScopeNode {
    const name = template.description || NODE_SPEC[template.type].label;
    const formulas = template.formulas ?? {};

    const description =
      compute(name, formulas.description, (text) => fillTemplate(text, scope)) ??
      template.description;

    const quantity = compute(name, formulas.quantity, (text) => {
      const value = formulaNumber(parseFormula(text), scope);
      return Math.max(0, Math.round(value * 1000) / 1000);
    });

    const unitCostCents = compute(name, formulas.unitCost, (text) =>
      Math.max(0, Math.round(formulaNumber(parseFormula(text), scope) * 100))
    );

    let sellPriceCents = compute(name, formulas.sellPrice, (text) =>
      Math.max(0, Math.round(formulaNumber(parseFormula(text), scope) * 100))
    );
    // A computed cost with a markup and no price formula prices itself the way
    // the row does when the cost is typed in.
    if (
      sellPriceCents === undefined &&
      unitCostCents !== undefined &&
      template.markupPercent !== null
    ) {
      sellPriceCents = sellFromCost(unitCostCents, template.markupPercent);
    }

    const children = template.children
      .filter((child) => {
        if (!child.when) return true;
        return (
          compute(child.description || "A row", child.when, (text) =>
            formulaTruthy(parseFormula(text), scope)
          ) ?? true
        );
      })
      .map(build);

    return makeNode(template.type, {
      description,
      section: template.section,
      quantity: quantity ?? template.quantity,
      unit: template.unit,
      unitCostCents: unitCostCents ?? template.unitCostCents,
      markupPercent: template.markupPercent,
      sellPriceCents: sellPriceCents ?? template.sellPriceCents,
      taxable: template.taxable,
      optional: template.optional,
      breakdown: template.breakdown ?? null,
      source,
      children,
    });
  }

  return { node: build(item.template), problems };
}

/* ── Saving ───────────────────────────────────────────────────────────── */

/**
 * A Scope row and everything in it, as a saved item's template. Identity,
 * change-order links and where the row came from are left behind — they belong
 * to the quote it was saved from.
 */
export function templateFromNode(node: ScopeNode): TemplateNode {
  const { when, ...formulas } = node.sizing ?? {};
  const written = Object.fromEntries(
    Object.entries(formulas).filter(([, source]) => source?.trim())
  ) as TemplateNode["formulas"];
  return {
    type: node.type,
    description: node.description,
    section: node.section,
    quantity: node.quantity,
    unit: node.unit,
    unitCostCents: node.unitCostCents,
    markupPercent: node.markupPercent,
    sellPriceCents: node.sellPriceCents,
    taxable: node.taxable,
    optional: node.optional,
    ...(node.breakdown ? { breakdown: node.breakdown } : {}),
    ...(written && Object.keys(written).length ? { formulas: written } : {}),
    ...(when?.trim() ? { when: when.trim() } : {}),
    children: node.children.map(templateFromNode),
  };
}

/**
 * A saved item's rows as editable Scope rows — the Library edits them with
 * the same editor a quote uses. Each row carries its formulas in `sizing`, and
 * `templateFromNode` turns the edited rows back into the template.
 *
 * Keys come from each row's place in the item rather than at random, so the
 * page drawn on the server and the one the browser takes over agree on them.
 */
export function nodeFromTemplate(template: TemplateNode, key = "row"): ScopeNode {
  const sizing = { ...(template.formulas ?? {}), ...(template.when ? { when: template.when } : {}) };
  return makeNode(template.type, {
    description: template.description,
    section: template.section,
    quantity: template.quantity,
    unit: template.unit,
    unitCostCents: template.unitCostCents,
    markupPercent: template.markupPercent,
    sellPriceCents: template.sellPriceCents,
    taxable: template.taxable,
    optional: template.optional,
    breakdown: template.breakdown ?? null,
    sizing: Object.keys(sizing).length ? sizing : null,
    key,
    children: template.children.map((child, index) => nodeFromTemplate(child, `${key}-${index}`)),
  });
}

/* ── Reading one ──────────────────────────────────────────────────────── */

/** How many priced rows the item places, at its defaults. */
export function pricedRowCount(template: TemplateNode): number {
  let count = 0;
  function visit(node: TemplateNode) {
    if (NODE_SPEC[node.type].priced) count += 1;
    node.children.forEach(visit);
  }
  visit(template);
  return count;
}

/**
 * The tile's subheading.
 *
 * An item with settings shows them — `36 × 48 in · Double hung` from its own
 * summary, or each setting in turn. One without shows what it holds and what
 * it comes to.
 */
export function describeSavedItem(
  item: Pick<SavedItem, "template" | "settings" | "summary" | "source">,
  values: SettingValues
): string {
  if (item.settings.length) {
    if (item.summary) {
      try {
        return fillTemplate(item.summary, values);
      } catch {
        // A summary that names a setting with no value falls back to the list.
      }
    }
    return item.settings
      .map((def) => formatSetting(def, values[def.key]))
      .join(" · ");
  }

  const kind = NODE_SPEC[item.template.type].label;
  const rows = pricedRowCount(item.template);
  const parts = [kind];
  if (NODE_SPEC[item.template.type].container) {
    parts.push(`${rows} row${rows === 1 ? "" : "s"}`);
  }
  const total = savedItemTotal(item, values);
  if (total > 0) parts.push(formatMoney(total));
  return parts.join(" · ");
}

/** What the item comes to when placed with these settings, optional rows included. */
export function savedItemTotal(
  item: Pick<SavedItem, "template" | "source">,
  values: SettingValues
): number {
  const { node } = expandSavedItem(item, values);
  return nodeTotal(node);
}

/** Every description in the item, for search. */
export function savedItemText(item: Pick<SavedItem, "name" | "template">): string {
  const words: string[] = [item.name];
  function visit(node: TemplateNode) {
    words.push(node.description);
    node.children.forEach(visit);
  }
  visit(item.template);
  return words.join(" ").toLowerCase();
}
