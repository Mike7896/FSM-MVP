"use client";

import { useState } from "react";
import { Sigma } from "lucide-react";

import { useScopeActions } from "@/components/quote-editor/scope/actions";
import { Input } from "@/components/ui/input";
import {
  fillTemplate,
  formulaIssue,
  formulaNumber,
  formulaTruthy,
  parseFormula,
  type SettingValues,
} from "@/lib/library";
import { NODE_SPEC, formatMoney, type RowSizing, type ScopeNode } from "@/lib/quote";
import { cn } from "@/lib/utils";

type Field = keyof RowSizing;

const LABEL: Record<Field, string> = {
  quantity: "Quantity",
  sellPrice: "Price each ($)",
  unitCost: "Cost each ($)",
  description: "Description",
  when: "Only include when",
};

/** The formula fields a row offers — money only where the row carries a price. */
function fieldsFor(node: ScopeNode, isRoot: boolean): Field[] {
  const spec = NODE_SPEC[node.type];
  const fields: Field[] = [];
  if (spec.priced || spec.container) fields.push("quantity");
  if (spec.priced) fields.push("sellPrice", "unitCost");
  fields.push("description");
  // The item itself is always placed; only the rows inside it can be left out.
  if (!isRoot) fields.push("when");
  return fields;
}

/** What a formula comes to at the defaults, or why it doesn't. */
function result(
  field: Field,
  source: string,
  keys: string[],
  values: SettingValues
): { text: string; problem: boolean } {
  const issue = formulaIssue(source, keys, field === "description");
  if (issue) return { text: issue, problem: true };
  try {
    switch (field) {
      case "description":
        return { text: `“${fillTemplate(source, values)}”`, problem: false };
      case "when":
        return {
          text: formulaTruthy(parseFormula(source), values)
            ? "Included at the defaults"
            : "Left out at the defaults",
          problem: false,
        };
      case "quantity":
        return {
          text: `= ${Math.round(formulaNumber(parseFormula(source), values) * 1000) / 1000}`,
          problem: false,
        };
      default:
        return {
          text: `= ${formatMoney(Math.round(formulaNumber(parseFormula(source), values) * 100))}`,
          problem: false,
        };
    }
  } catch (error) {
    // Reads fine but can't be worked out at these values — a setting with no
    // default, a division by zero. Not wrong, so not red.
    return {
      text: error instanceof Error ? `At the defaults: ${error.message}` : "Can't be worked out at the defaults",
      problem: false,
    };
  }
}

/**
 * How one saved row is sized from the item's settings — drawn under the row
 * in the Library's editor.
 *
 * Closed, a row shows the formulas it has in one quiet line; a row with none
 * shows only the way to add one, so a plain saved row reads like a quote row.
 */
export function RowSizingEditor({
  node,
  isRoot,
  settingKeys,
  values,
}: {
  node: ScopeNode;
  isRoot: boolean;
  settingKeys: string[];
  values: SettingValues;
}) {
  const { patch } = useScopeActions();
  const sizing = node.sizing ?? {};
  const fields = fieldsFor(node, isRoot);
  const written = fields.filter((field) => sizing[field]?.trim());
  const [open, setOpen] = useState(false);

  function set(field: Field, source: string) {
    const next: RowSizing = { ...sizing, [field]: source };
    if (!source.trim()) delete next[field];
    patch(node.key, { sizing: Object.keys(next).length ? next : null });
  }

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
        {written.map((field) => {
          // The formula and what it comes to — the row's own number above is
          // only what's used when a formula can't be worked out.
          const shown = result(field, sizing[field]!, settingKeys, values);
          return (
            <span key={field} className="text-muted-foreground min-w-0">
              {LABEL[field]}:{" "}
              <code className={cn("text-foreground", shown.problem && "text-destructive")}>
                {sizing[field]}
              </code>{" "}
              <span className={cn(shown.problem && "text-destructive")}>{shown.text}</span>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline underline-offset-4"
        >
          <Sigma className="size-3" />
          {written.length ? "Edit sizing" : "Size from settings"}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-muted/40 mt-3 flex flex-col gap-2.5 rounded-md border border-dashed p-3 text-xs">
      <p className="text-muted-foreground leading-relaxed">
        {settingKeys.length
          ? <>Formulas can use {settingKeys.map((key, index) => (
              <span key={key}>
                {index ? ", " : ""}
                <code className="text-foreground">{key}</code>
              </span>
            ))}. In a description, put them in braces: <code className="text-foreground">{`{${settingKeys[0]}}`}</code>.
            Left empty, the row keeps what&apos;s typed above.</>
          : "Add a setting first — formulas size the row from its settings."}
      </p>
      {fields.map((field) => {
        const source = sizing[field] ?? "";
        const shown = source.trim() ? result(field, source, settingKeys, values) : null;
        return (
          <label key={field} className="grid gap-1 @md/office:grid-cols-[8rem_minmax(0,1fr)] @md/office:items-center">
            <span className="text-muted-foreground">{LABEL[field]}</span>
            <span className="flex flex-col gap-0.5">
              <Input
                value={source}
                onChange={(event) => set(field, event.target.value)}
                aria-label={`${LABEL[field]} formula for ${node.description || NODE_SPEC[node.type].label}`}
                className={cn("h-8 font-mono text-xs", shown?.problem && "border-destructive")}
              />
              {shown ? (
                <span className={cn(shown.problem ? "text-destructive" : "text-muted-foreground")}>
                  {shown.text}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-muted-foreground hover:text-foreground self-start underline underline-offset-4"
      >
        Done
      </button>
    </div>
  );
}
