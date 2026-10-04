import { z } from "zod";

import { isValidSetting } from "@/lib/library/expand";
import {
  FormulaError,
  formulaNames,
  parseFormula,
  templateFormulas,
} from "@/lib/library/formula";
import type { SettingDef, TemplateNode } from "@/lib/library/types";
import { NODE_SPEC } from "@/lib/quote";

import { lineSectionSchema, lineTypeSchema } from "./quote";

/**
 * Saved items and job settings on the wire.
 *
 * The shapes are checked by Zod; the rules that span them — a formula naming a
 * setting the item doesn't have, a default that isn't one of a choice's values,
 * a template deeper than Scope allows — by `savedItemIssues`, so a broken
 * formula is refused when it is saved rather than discovered on a drop.
 */

const RESERVED = new Set([
  "true", "false", "and", "or", "not",
  "ceil", "floor", "round", "min", "max", "abs", "sqrt",
]);

const settingKeySchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/, "Letters, numbers and _ only, starting with a letter.")
  .refine((key) => !RESERVED.has(key), "That name is taken by the formula language.");

export const settingDefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("number"),
    key: settingKeySchema,
    label: z.string().trim().min(1).max(60),
    unit: z.string().trim().max(20).nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
  }),
  z.object({
    kind: z.literal("choice"),
    key: settingKeySchema,
    label: z.string().trim().min(1).max(60),
    choices: z
      .array(
        z.object({
          value: z.string().trim().min(1).max(60),
          label: z.string().trim().min(1).max(60),
        })
      )
      .min(1)
      .max(40),
  }),
]);

const formulaSchema = z.string().trim().min(1).max(500);

export const templateNodeSchema: z.ZodType<TemplateNode> = z.lazy(() =>
  z.object({
    type: lineTypeSchema,
    description: z.string().trim().max(500),
    section: lineSectionSchema.nullable(),
    quantity: z.number().min(0).max(1_000_000),
    unit: z.string().trim().max(20).nullable(),
    unitCostCents: z.number().int().min(0).nullable(),
    markupPercent: z.number().min(-100).max(10_000).nullable(),
    sellPriceCents: z.number().int().min(0),
    taxable: z.boolean(),
    optional: z.boolean(),
    breakdown: z.enum(["show", "hide"]).nullable().optional(),
    children: z.array(templateNodeSchema).max(200),
    formulas: z
      .object({
        description: formulaSchema.optional(),
        quantity: formulaSchema.optional(),
        sellPriceCents: formulaSchema.optional(),
        unitCostCents: formulaSchema.optional(),
      })
      .optional(),
    when: formulaSchema.optional(),
  })
);

const settingValueSchema = z.union([z.number(), z.string().max(60)]);
export const settingValuesSchema = z.record(settingKeySchema, settingValueSchema);

const nameSchema = z.string().trim().min(1, "Give it a name.").max(120);

export const savedItemCreateSchema = z.object({
  name: nameSchema,
  template: templateNodeSchema,
  settings: z.array(settingDefSchema).max(20).default([]),
  defaults: settingValuesSchema.default({}),
  summary: z.string().trim().max(200).nullable().default(null),
});

export const savedItemPatchSchema = z
  .object({
    name: nameSchema,
    template: templateNodeSchema,
    settings: z.array(settingDefSchema).max(20),
    defaults: settingValuesSchema,
    summary: z.string().trim().max(200).nullable(),
  })
  .partial();

export const jobItemSettingsPutSchema = z.object({
  savedItemId: z.uuid(),
  /** An empty object clears the job's settings for that item. */
  values: settingValuesSchema,
});

/**
 * Everything wrong with a saved item that its shape alone can't show.
 * Empty means it can be stored.
 */
export function savedItemIssues(item: {
  template: TemplateNode;
  settings: SettingDef[];
  defaults: Record<string, unknown>;
  summary: string | null;
}): string[] {
  const issues: string[] = [];
  const keys = new Set(item.settings.map((def) => def.key));

  if (keys.size !== item.settings.length) {
    issues.push("Two settings share a name.");
  }

  for (const [key, value] of Object.entries(item.defaults)) {
    const def = item.settings.find((candidate) => candidate.key === key);
    if (!def) issues.push(`The default for "${key}" has no setting.`);
    else if (!isValidSetting(def, value)) issues.push(`The default for ${def.label} doesn't fit it.`);
  }

  let count = 0;
  function checkFormula(where: string, source: string, sentence = false) {
    try {
      const formulas = sentence ? templateFormulas(source) : [parseFormula(source)];
      for (const formula of formulas) {
        for (const name of formulaNames(formula)) {
          if (!keys.has(name)) issues.push(`${where} uses "${name}", which isn't one of the settings.`);
        }
      }
    } catch (error) {
      issues.push(`${where}: ${error instanceof FormulaError ? error.message : "the formula can't be read."}`);
    }
  }

  function visit(node: TemplateNode, isRoot: boolean) {
    count += 1;
    const spec = NODE_SPEC[node.type];
    const where = node.description || spec.label;

    if (!spec.container && node.children.length) {
      issues.push(`${where} can't hold rows — only a group or an assembly can.`);
    }
    if (spec.bucketed !== (node.section !== null)) {
      issues.push(spec.bucketed ? `${where} needs a cost bucket.` : `${where} can't carry a cost bucket.`);
    }

    const formulas = node.formulas ?? {};
    if (formulas.description) checkFormula(where, formulas.description, true);
    if (formulas.quantity) checkFormula(where, formulas.quantity);
    if (formulas.sellPriceCents) checkFormula(where, formulas.sellPriceCents);
    if (formulas.unitCostCents) checkFormula(where, formulas.unitCostCents);
    if (node.when) {
      if (isRoot) issues.push("The item itself can't be conditional — only the rows inside it.");
      else checkFormula(where, node.when);
    }

    node.children.forEach((child) => visit(child, false));
  }
  visit(item.template, true);

  if (count > 300) issues.push("A saved item holds up to 300 rows.");
  if (item.summary) checkFormula("The summary", item.summary, true);

  return issues;
}
