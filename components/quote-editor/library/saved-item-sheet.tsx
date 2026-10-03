"use client";

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { KIND_ICON } from "@/components/quote-editor/library/library-panel";
import { useLibraryMutations } from "@/components/quote-editor/library/use-library";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  describeSavedItem,
  expandSavedItem,
  formatSetting,
  resolveSettings,
  type SavedItem,
  type SettingDef,
  type SettingValue,
  type SettingValues,
} from "@/lib/library";
import {
  NODE_SPEC,
  formatMoney,
  formatQuantity,
  isPriced,
  nodeTotal,
  type ScopeNode,
} from "@/lib/quote";
import { cn } from "@/lib/utils";

const USE_DEFAULT = "__default";

/**
 * One saved item, opened from its tile — the side panel the defaults are set
 * in, and where this job's own settings live.
 *
 * **Defaults** are the Office's, for every job. **This job** overrides them for
 * this job only, and an empty one means the default is used. What it will add
 * is shown with exactly the settings a drop would use.
 */
export function SavedItemSheet({
  item,
  jobId,
  jobValues,
  onOpenChange,
  onAdd,
}: {
  item: SavedItem;
  /** Null until the quote's first save gives it a job. */
  jobId: string | null;
  jobValues: SettingValues | null;
  onOpenChange: (open: boolean) => void;
  onAdd: (item: SavedItem) => void;
}) {
  const isMobile = useIsMobile();
  const { update, remove, setJobSettings } = useLibraryMutations(jobId);
  const [confirming, setConfirming] = useState(false);
  // Set by Add to scope, so closing leaves the page on the new rows instead of
  // handing focus — and the scroll position — back to the tile.
  const added = useRef(false);

  const resolved = resolveSettings(item.settings, item.defaults, jobValues);
  const { node, problems } = expandSavedItem(item, resolved.values);
  const Icon = KIND_ICON[item.template.type];
  const kind = NODE_SPEC[item.template.type].label;

  function fail(error: unknown) {
    toast.error(error instanceof Error ? error.message : "That didn't save.");
  }

  function rename(name: string) {
    const next = name.trim();
    if (!next || next === item.name) return;
    update.mutate({ id: item.id, name: next }, { onError: fail });
  }

  function setDefault(def: SettingDef, value: SettingValue | null) {
    const defaults = { ...item.defaults };
    if (value === null) delete defaults[def.key];
    else defaults[def.key] = value;
    update.mutate({ id: item.id, defaults }, { onError: fail });
  }

  function setJob(def: SettingDef, value: SettingValue | null) {
    const values = { ...(jobValues ?? {}) };
    if (value === null) delete values[def.key];
    else values[def.key] = value;
    setJobSettings.mutate({ savedItemId: item.id, values }, { onError: fail });
  }

  function confirmDelete() {
    remove.mutate(item.id, {
      onSuccess: () => {
        toast(`Deleted ${item.name} from your library`);
        onOpenChange(false);
      },
      onError: fail,
    });
  }

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "gap-0 p-0",
          isMobile ? "max-h-[92vh]" : "w-full data-[side=right]:sm:max-w-md"
        )}
        // Opening shouldn't drop the cursor into the name and select it.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          if (added.current) event.preventDefault();
        }}
      >
        <div className="flex items-start gap-3 border-b px-4 py-3 pr-12">
          <span className="bg-muted/60 text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <SheetTitle className="sr-only">{item.name}</SheetTitle>
            <span className="text-muted-foreground font-label text-[10px] uppercase">
              {kind} · Saved in your library
            </span>
            <Input
              key={item.name}
              defaultValue={item.name}
              aria-label="Name"
              onBlur={(event) => rename(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="-ml-2 h-8 border-transparent px-2 text-base font-semibold shadow-none hover:border-input focus-visible:border-ring"
            />
            <SheetDescription className="text-xs tabular-nums">
              {describeSavedItem(item, resolved.values)}
            </SheetDescription>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 [scrollbar-width:thin]">
          {item.settings.length ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Settings</h3>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Defaults apply on every job. This job&apos;s settings change it
                here only — leave one empty to use the default.
              </p>
              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] items-center gap-x-2 gap-y-2 text-sm">
                <span />
                <span className="text-muted-foreground font-label text-[10px] uppercase">
                  Default
                </span>
                <span className="text-muted-foreground font-label text-[10px] uppercase">
                  This job
                </span>
                {item.settings.map((def) => (
                  <SettingRow
                    key={def.key}
                    def={def}
                    defaultValue={item.defaults[def.key]}
                    jobValue={jobValues?.[def.key]}
                    jobAvailable={jobId !== null}
                    onDefault={(value) => setDefault(def, value)}
                    onJob={(value) => setJob(def, value)}
                  />
                ))}
              </div>
              {jobId === null ? (
                <p className="text-muted-foreground text-xs leading-relaxed">
                  This job&apos;s settings can be set once the quote is saved —
                  which happens as soon as you type anything into it.
                </p>
              ) : null}
            </section>
          ) : null}

          {problems.length ? (
            <section className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-xs leading-relaxed">
              <p className="text-foreground font-medium">
                Some numbers couldn&apos;t be worked out, so the saved ones are used:
              </p>
              <ul className="mt-1 list-disc pl-4">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">What it adds</h3>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Ordinary rows, edited like any other once they&apos;re in Scope.
              Changing this saved item later won&apos;t change quotes it&apos;s
              already in.
            </p>
            <div className="rounded-md border">
              <PreviewRows nodes={[node]} depth={0} />
            </div>
          </section>

          <p className="text-muted-foreground text-xs">
            {item.timesUsed
              ? `Added ${item.timesUsed} time${item.timesUsed === 1 ? "" : "s"}`
              : "Not added to a quote yet"}
            {" · "}Saved{" "}
            {new Date(item.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
          <Button
            onClick={() => {
              added.current = true;
              onAdd(item);
              onOpenChange(false);
            }}
          >
            <Plus className="size-4" />
            Add to scope
          </Button>
        </div>
      </SheetContent>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {item.name} from your library?</AlertDialogTitle>
            <AlertDialogDescription>
              Quotes it was added to keep their rows. Any job settings for it
              are deleted with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function SettingRow({
  def,
  defaultValue,
  jobValue,
  jobAvailable,
  onDefault,
  onJob,
}: {
  def: SettingDef;
  defaultValue: SettingValue | undefined;
  jobValue: SettingValue | undefined;
  jobAvailable: boolean;
  onDefault: (value: SettingValue | null) => void;
  onJob: (value: SettingValue | null) => void;
}) {
  return (
    <>
      <span className="min-w-0 truncate">
        {def.label}
        {def.kind === "number" && def.unit ? (
          <span className="text-muted-foreground"> ({def.unit})</span>
        ) : null}
      </span>
      <SettingInput
        def={def}
        value={defaultValue}
        emptyLabel="Not set"
        label={`${def.label} default`}
        onCommit={onDefault}
      />
      {jobAvailable ? (
        <SettingInput
          def={def}
          value={jobValue}
          emptyLabel="Default"
          label={`${def.label} for this job`}
          onCommit={onJob}
        />
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      )}
    </>
  );
}

/**
 * A number field that commits when it loses focus, or a choice list. Empty
 * commits as "not set". Keyed on the value, so a saved change re-seeds it.
 */
function SettingInput({
  def,
  value,
  emptyLabel,
  label,
  onCommit,
}: {
  def: SettingDef;
  value: SettingValue | undefined;
  /** What an empty field means — "Default" for a job, "Not set" for a default. */
  emptyLabel: string;
  label: string;
  onCommit: (value: SettingValue | null) => void;
}) {
  if (def.kind === "choice") {
    return (
      <Select
        value={typeof value === "string" ? value : USE_DEFAULT}
        onValueChange={(next) => onCommit(next === USE_DEFAULT ? null : next)}
      >
        <SelectTrigger size="sm" className="w-full min-w-0 text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={USE_DEFAULT} className="text-muted-foreground text-xs">
            {emptyLabel}
          </SelectItem>
          {def.choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value} className="text-xs">
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      key={String(value ?? "")}
      defaultValue={value === undefined ? "" : String(value)}
      inputMode="decimal"
      aria-label={label}
      placeholder={emptyLabel}
      className="h-7 text-xs tabular-nums"
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onBlur={(event) => {
        const raw = event.target.value.trim();
        if (raw === "") {
          if (value !== undefined) onCommit(null);
          return;
        }
        const next = Number(raw.replace(/,/g, ""));
        const fits =
          Number.isFinite(next) &&
          (def.min === null || next >= def.min) &&
          (def.max === null || next <= def.max);
        if (!fits) {
          toast.error(
            def.min !== null && def.max !== null
              ? `${def.label} goes from ${formatSetting(def, def.min)} to ${formatSetting(def, def.max)}.`
              : `${def.label} needs a number.`
          );
          event.target.value = value === undefined ? "" : String(value);
          return;
        }
        if (next !== value) onCommit(next);
      }}
    />
  );
}

function PreviewRows({ nodes, depth }: { nodes: ScopeNode[]; depth: number }) {
  return (
    <ul className={cn(depth > 0 && "border-l ml-4")}>
      {nodes.map((node, index) => {
        const spec = NODE_SPEC[node.type];
        const amount = spec.priced || spec.container ? nodeTotal(node) : null;
        return (
          <li key={node.key} className={cn(index > 0 && "border-t", depth === 0 && "first:border-t-0")}>
            <div
              className={cn(
                "flex items-baseline justify-between gap-3 px-3 py-2 text-[13px]",
                spec.container && "bg-muted/40 font-medium",
                !spec.priced && !spec.container && "text-muted-foreground"
              )}
            >
              <span className="min-w-0">
                <span className="block truncate">
                  {node.description || spec.label}
                </span>
                {isPriced(node) ? (
                  <span className="text-muted-foreground block text-xs tabular-nums">
                    {formatQuantity(node.quantity)}
                    {node.unit ? ` ${node.unit}` : ""} × {formatMoney(node.sellPriceCents)}
                  </span>
                ) : null}
              </span>
              {amount !== null ? (
                <span className="shrink-0 tabular-nums">{formatMoney(amount)}</span>
              ) : null}
            </div>
            {node.children.length ? (
              <PreviewRows nodes={node.children} depth={depth + 1} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
