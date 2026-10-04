"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useLibraryMutations } from "@/components/quote-editor/library/use-library";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatSetting,
  isValidSetting,
  type SavedItem,
  type SettingDef,
  type SettingValue,
  type SettingValues,
} from "@/lib/library";

const USE_DEFAULT = "__default";

/**
 * This job's own settings for library items — this house's standard window.
 *
 * **Set once on the job, used by every drop of that item on any of its
 * quotes**, and never touching the Office's defaults or any other job (UX:
 * Saved Items and Job Settings, decision 4). Empty means the Office's default.
 * The quote editor's item sheet edits the same values; this is where they're
 * set without opening a quote.
 */
export function JobItemSettings({
  jobId,
  items,
  initial,
  className,
  heading,
}: {
  jobId: string;
  /** Library items that have settings. */
  items: SavedItem[];
  initial: Record<string, SettingValues>;
  className?: string;
  heading: React.ReactNode;
}) {
  const { setJobSettings } = useLibraryMutations(jobId);
  const [values, setValues] = useState(initial);

  function set(item: SavedItem, def: SettingDef, value: SettingValue | null) {
    const next = { ...(values[item.id] ?? {}) };
    if (value === null) delete next[def.key];
    else next[def.key] = value;
    const previous = values;
    setValues({ ...values, [item.id]: next });
    setJobSettings.mutate(
      { savedItemId: item.id, values: next },
      {
        onError: (error) => {
          setValues(previous);
          toast.error(error.message);
        },
      }
    );
  }

  return (
    <section className={className}>
      {heading}
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
        What this job uses when these items are added to its quotes. Left empty,
        the Office&apos;s default is used.
      </p>
      <div className="mt-3 flex flex-col">
        {items.map((item) => (
          <div key={item.id} className="border-t py-3">
            <p className="text-sm font-medium">{item.name}</p>
            <div className="mt-2 flex flex-col gap-2">
              {item.settings.map((def) => (
                <SettingRow
                  key={def.key}
                  def={def}
                  value={values[item.id]?.[def.key]}
                  fallback={item.defaults[def.key]}
                  onChange={(value) => set(item, def, value)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingRow({
  def,
  value,
  fallback,
  onChange,
}: {
  def: SettingDef;
  value: SettingValue | undefined;
  fallback: SettingValue | undefined;
  onChange: (value: SettingValue | null) => void;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [problem, setProblem] = useState<string | null>(null);
  const defaultText =
    fallback === undefined ? "No default" : `Default ${formatSetting(def, fallback)}`;

  if (def.kind === "choice") {
    return (
      <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 text-xs">
        <span className="text-muted-foreground truncate">{def.label}</span>
        <Select
          value={typeof value === "string" ? value : USE_DEFAULT}
          onValueChange={(next) => onChange(next === USE_DEFAULT ? null : next)}
        >
          <SelectTrigger className="h-8 w-full text-xs" aria-label={def.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={USE_DEFAULT}>{defaultText}</SelectItem>
            {def.choices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    );
  }

  // Narrowed for the closure below, which TypeScript doesn't carry it into.
  const range = def;

  function commit() {
    const trimmed = text.trim();
    if (trimmed === "") {
      setProblem(null);
      if (value !== undefined) onChange(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!isValidSetting(range, parsed)) {
      setProblem(
        range.min !== null || range.max !== null
          ? `Between ${range.min ?? "any"} and ${range.max ?? "any"}.`
          : "Enter a number."
      );
      return;
    }
    setProblem(null);
    if (parsed !== value) onChange(parsed);
  }

  return (
    <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-start gap-2 text-xs">
      <span className="text-muted-foreground truncate pt-2">{def.label}</span>
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <Input
            inputMode="decimal"
            value={text}
            aria-label={def.label}
            className="h-8 text-xs"
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
          />
          {def.unit ? <span className="text-muted-foreground shrink-0">{def.unit}</span> : null}
        </span>
        <span className={problem ? "text-destructive" : "text-muted-foreground"}>
          {problem ??
            (value !== undefined
              ? defaultText
              : fallback === undefined
                ? "Not set"
                : `Using the default, ${formatSetting(def, fallback)}`)}
        </span>
      </span>
    </label>
  );
}
