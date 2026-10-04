"use client";

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SettingDef, SettingValue, SettingValues } from "@/lib/library";

/**
 * A setting as it's being edited: the definition, its default, and whether its
 * formula name still follows its label.
 *
 * **A formula name follows the label only until it's been saved or typed.**
 * Formulas refer to a setting by that name, so renaming "Width" to "Opening
 * width" on a saved item must not quietly break every formula that says
 * `width`.
 */
export type DraftSetting = {
  id: string;
  autoKey: boolean;
  def: SettingDef;
  value: SettingValue | null;
  /** Choice values that still follow their labels — new options, not yet saved. */
  autoChoices: boolean[];
};

const RESERVED = new Set([
  "true", "false", "and", "or", "not",
  "ceil", "floor", "round", "min", "max", "abs", "sqrt",
]);

let seed = 0;
const newId = () => `setting-${++seed}`;

/** `Opening width` → `opening_width` — a name a formula can use. */
export function formulaName(label: string): string {
  let name = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!name) return "";
  if (!/^[a-z_]/.test(name)) name = `s_${name}`.slice(0, 40);
  if (RESERVED.has(name)) name = `${name}_1`;
  return name;
}

export function draftSettings(settings: SettingDef[], defaults: SettingValues): DraftSetting[] {
  return settings.map((def) => ({
    id: newId(),
    autoKey: false,
    def,
    value: defaults[def.key] ?? null,
    autoChoices: def.kind === "choice" ? def.choices.map(() => false) : [],
  }));
}

/** The drafts as the item stores them. */
export function savedSettings(drafts: DraftSetting[]): {
  settings: SettingDef[];
  defaults: SettingValues;
} {
  const defaults: SettingValues = {};
  for (const draft of drafts) {
    if (draft.value !== null && draft.value !== "") defaults[draft.def.key] = draft.value;
  }
  return { settings: drafts.map((draft) => draft.def), defaults };
}

/** What's wrong with one setting's names, for the line under it. */
function nameIssue(draft: DraftSetting, all: DraftSetting[]): string | null {
  const key = draft.def.key;
  if (!draft.def.label.trim()) return "Give it a name.";
  if (!key) return "It needs a name formulas can use.";
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key)) {
    return "Formula names are letters, numbers and _, starting with a letter.";
  }
  if (RESERVED.has(key)) return `"${key}" is taken by the formula language.`;
  if (all.some((other) => other !== draft && other.def.key === key)) {
    return `Another setting is already called "${key}".`;
  }
  return null;
}

/**
 * The settings an item is sized by — a window's width, height and style — and
 * the Office's default for each, used on every job that hasn't set its own.
 */
export function SettingsEditor({
  drafts,
  onChange,
}: {
  drafts: DraftSetting[];
  onChange: (drafts: DraftSetting[]) => void;
}) {
  function patch(id: string, recipe: (draft: DraftSetting) => DraftSetting) {
    onChange(drafts.map((draft) => (draft.id === id ? recipe(draft) : draft)));
  }

  function add() {
    onChange([
      ...drafts,
      {
        id: newId(),
        autoKey: true,
        def: { kind: "number", key: "", label: "", unit: null, min: null, max: null },
        value: null,
        autoChoices: [],
      },
    ]);
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-5">
      <div>
        <h2 className="font-label text-[11px] uppercase">Settings</h2>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          What the item is sized by. Each default is used on every job that
          hasn&apos;t set its own, and formulas on the rows use each setting by
          its formula name.
        </p>
      </div>

      {drafts.map((draft, index) => (
        <SettingCard
          key={draft.id}
          draft={draft}
          index={index}
          issue={nameIssue(draft, drafts)}
          onPatch={(recipe) => patch(draft.id, recipe)}
          onRemove={() => onChange(drafts.filter((other) => other.id !== draft.id))}
        />
      ))}

      <Button type="button" variant="outline" size="sm" className="self-start" onClick={add}>
        <Plus />
        Add a setting
      </Button>
    </section>
  );
}

function SettingCard({
  draft,
  index,
  issue,
  onPatch,
  onRemove,
}: {
  draft: DraftSetting;
  index: number;
  issue: string | null;
  onPatch: (recipe: (draft: DraftSetting) => DraftSetting) => void;
  onRemove: () => void;
}) {
  const { def } = draft;
  const label = def.label.trim() || `Setting ${index + 1}`;

  function setKind(kind: SettingDef["kind"]) {
    onPatch((current) => ({
      ...current,
      value: null,
      autoChoices: [],
      def:
        kind === "number"
          ? { kind, key: current.def.key, label: current.def.label, unit: null, min: null, max: null }
          : { kind, key: current.def.key, label: current.def.label, choices: [] },
    }));
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Input
          value={def.label}
          aria-label={`Setting ${index + 1} name`}
          placeholder={`Setting ${index + 1}`}
          onChange={(event) => {
            const text = event.target.value;
            onPatch((current) => ({
              ...current,
              def: {
                ...current.def,
                label: text,
                key: current.autoKey ? formulaName(text) : current.def.key,
              },
            }));
          }}
        />
        <Select value={def.kind} onValueChange={(value) => setKind(value as SettingDef["kind"])}>
          <SelectTrigger className="w-28 shrink-0" aria-label={`${label} kind`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="number">Number</SelectItem>
            <SelectItem value="choice">Choice</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <X />
        </Button>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground shrink-0">In formulas</span>
        <Input
          value={def.key}
          aria-label={`${label} formula name`}
          className="h-7 font-mono text-xs"
          onChange={(event) => {
            const key = event.target.value.trim();
            onPatch((current) => ({ ...current, autoKey: false, def: { ...current.def, key } }));
          }}
        />
      </label>
      {issue ? <p className="text-destructive -mt-1 text-xs">{issue}</p> : null}

      {def.kind === "number" ? (
        <NumberFields draft={draft} label={label} onPatch={onPatch} />
      ) : (
        <ChoiceFields draft={draft} label={label} onPatch={onPatch} />
      )}
    </div>
  );
}

/** A number input that holds `null` for empty rather than turning it into 0. */
function NumberInput({
  value,
  onChange,
  ...props
}: {
  value: number | null;
  onChange: (value: number | null) => void;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type">) {
  return (
    <Input
      {...props}
      type="number"
      step="any"
      value={value ?? ""}
      onChange={(event) => {
        const text = event.target.value;
        const parsed = Number(text);
        onChange(text === "" || !Number.isFinite(parsed) ? null : parsed);
      }}
    />
  );
}

function NumberFields({
  draft,
  label,
  onPatch,
}: {
  draft: DraftSetting;
  label: string;
  onPatch: (recipe: (draft: DraftSetting) => DraftSetting) => void;
}) {
  const def = draft.def as Extract<SettingDef, { kind: "number" }>;
  const set = (fields: Partial<typeof def>) =>
    onPatch((current) => ({ ...current, def: { ...(current.def as typeof def), ...fields } }));
  const value = typeof draft.value === "number" ? draft.value : null;
  const outside =
    value !== null &&
    ((def.min !== null && value < def.min) || (def.max !== null && value > def.max));

  return (
    <div className="grid grid-cols-2 gap-2 text-xs @md/office:grid-cols-4">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Unit</span>
        <Input
          value={def.unit ?? ""}
          aria-label={`${label} unit`}
          className="h-8"
          onChange={(event) => set({ unit: event.target.value.trim() || null })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Lowest</span>
        <NumberInput value={def.min} aria-label={`${label} lowest`} className="h-8" onChange={(min) => set({ min })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Highest</span>
        <NumberInput value={def.max} aria-label={`${label} highest`} className="h-8" onChange={(max) => set({ max })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Default</span>
        <NumberInput
          value={value}
          aria-label={`${label} default`}
          className="h-8"
          onChange={(next) => onPatch((current) => ({ ...current, value: next }))}
        />
      </label>
      {outside ? (
        <p className="text-destructive col-span-full">
          The default is outside the lowest and highest values.
        </p>
      ) : null}
    </div>
  );
}

function ChoiceFields({
  draft,
  label,
  onPatch,
}: {
  draft: DraftSetting;
  label: string;
  onPatch: (recipe: (draft: DraftSetting) => DraftSetting) => void;
}) {
  const def = draft.def as Extract<SettingDef, { kind: "choice" }>;

  function setChoices(
    choices: typeof def.choices,
    autoChoices: boolean[],
    value: SettingValue | null = draft.value
  ) {
    onPatch((current) => ({
      ...current,
      value,
      autoChoices,
      def: { ...(current.def as typeof def), choices },
    }));
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      <span className="text-muted-foreground">Options</span>
      {def.choices.map((choice, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={choice.label}
            aria-label={`${label} option ${index + 1}`}
            placeholder={`Option ${index + 1}`}
            className="h-8"
            onChange={(event) => {
              const text = event.target.value;
              const choices = def.choices.map((other, at) =>
                at === index
                  ? {
                      label: text,
                      value: draft.autoChoices[at] ? formulaName(text) : other.value,
                    }
                  : other
              );
              // A default that pointed at this option follows it.
              const value =
                draft.value === choice.value ? choices[index].value : draft.value;
              setChoices(choices, draft.autoChoices, value);
            }}
          />
          <code className="text-muted-foreground w-28 shrink-0 truncate" title="What a formula compares against">
            &quot;{choice.value}&quot;
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={`Remove option ${index + 1}`}
            onClick={() =>
              setChoices(
                def.choices.filter((_, at) => at !== index),
                draft.autoChoices.filter((_, at) => at !== index),
                draft.value === choice.value ? null : draft.value
              )
            }
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() =>
          setChoices([...def.choices, { value: "", label: "" }], [...draft.autoChoices, true])
        }
      >
        <Plus />
        Add an option
      </Button>

      <label className="flex items-center gap-2">
        <span className="text-muted-foreground shrink-0">Default</span>
        <Select
          value={typeof draft.value === "string" && draft.value ? draft.value : undefined}
          onValueChange={(value) => onPatch((current) => ({ ...current, value }))}
        >
          <SelectTrigger className="h-8 w-full" aria-label={`${label} default`}>
            <SelectValue placeholder="No default" />
          </SelectTrigger>
          <SelectContent>
            {def.choices
              .filter((choice) => choice.value)
              .map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label || choice.value}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
