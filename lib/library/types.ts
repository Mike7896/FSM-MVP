import type { LineSection, NodeType, RowSizing } from "@/lib/quote";

/**
 * Saved items — rows, groups and assemblies kept in the Office's Library and
 * dropped back into Scope.
 *
 * Imported by client components, so nothing here touches the database.
 */

/** One setting a saved item is sized by — a window's width, its style. */
export type SettingDef =
  | {
      kind: "number";
      /** What formulas call it: `width`. Letters, digits and `_`. */
      key: string;
      label: string;
      unit: string | null;
      min: number | null;
      max: number | null;
    }
  | {
      kind: "choice";
      key: string;
      label: string;
      choices: { value: string; label: string }[];
    };

export type SettingValue = number | string;
export type SettingValues = Record<string, SettingValue>;

/**
 * What can be computed on a row when the item is placed. Each is a formula
 * over the settings (`lib/library/formula.ts`); `description` is a sentence
 * with formulas in braces. **Money formulas are in dollars**, the unit the
 * contractor writes them in — `width * height / 144 * 4.5` — and become cents
 * when the row is placed.
 */
export type TemplateFormulas = Omit<RowSizing, "when">;

/**
 * One row of a saved item — a Scope node without identity. The static values
 * are what lands when there are no formulas, or when one can't be worked out.
 */
export type TemplateNode = {
  type: NodeType;
  description: string;
  section: LineSection | null;
  quantity: number;
  unit: string | null;
  unitCostCents: number | null;
  markupPercent: number | null;
  sellPriceCents: number;
  taxable: boolean;
  optional: boolean;
  /** Groups and assemblies: what the customer sees of them. Null follows the quote. */
  breakdown?: "show" | "hide" | null;
  children: TemplateNode[];
  formulas?: TemplateFormulas;
  /** Placed only when this holds — `style == "french"`. */
  when?: string;
};

/** A saved item as the API returns it. */
export type SavedItem = {
  id: string;
  name: string;
  template: TemplateNode;
  settings: SettingDef[];
  /** The Office's defaults — used on every job that hasn't set its own. */
  defaults: SettingValues;
  /** The tile's subheading, with settings in braces. Null: built from the settings. */
  summary: string | null;
  imageUrl: string | null;
  /** `shop` when the Office saved it; `pack` when it came with a trade pack. */
  source: "shop" | "pack";
  packId: string | null;
  timesUsed: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A job's own settings, per saved item — overrides of the defaults. */
export type JobItemSettings = Record<string, SettingValues>;
