"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  SettingsEditor,
  draftSettings,
  savedSettings,
  type DraftSetting,
} from "@/components/library/settings-editor";
import { RowSizingEditor } from "@/components/library/row-sizing";
import { useLibraryMutations } from "@/components/quote-editor/library/use-library";
import { ScopeActionsProvider } from "@/components/quote-editor/scope/actions";
import { ScopeTree } from "@/components/quote-editor/scope/scope-tree";
import { useScopeEditor } from "@/components/quote-editor/scope/use-scope-editor";
import type { ScopeUpdate } from "@/components/quote-editor/scope/scope-section";
import { SaveBar } from "@/components/save-bar";
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
  expandSavedItem,
  nodeFromTemplate,
  resolveSettings,
  templateFromNode,
  type SavedItem,

} from "@/lib/library";
import {
  NODE_SPEC,
  formatMoney,
  formatQuantity,
  isPriced,
  leafTotal,
  nodeTotal,
  walk,
  type ScopeNode,
} from "@/lib/quote";

/**
 * One saved item, opened in the Office — its name, its rows, the settings that
 * size them and their defaults.
 *
 * **The rows are edited with the quote editor's own row editor**, because what
 * lands in a quote is ordinary rows and they should behave the same here as
 * there. What only a saved row has — formulas over the settings — sits under
 * each row, closed until it's wanted.
 *
 * **Saved on a button, not as you type.** A half-written formula is a broken
 * item, and every quote that drops it in would meet the half-written version.
 */
export function SavedItemEditor({ item: initial }: { item: SavedItem }) {
  const router = useRouter();
  const client = useQueryClient();
  const { update, remove } = useLibraryMutations(null);

  const [item, setItem] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [rows, setRows] = useState<ScopeNode[]>(() => [nodeFromTemplate(initial.template)]);
  const [settings, setSettings] = useState<DraftSetting[]>(() =>
    draftSettings(initial.settings, initial.defaults)
  );
  const [summary, setSummary] = useState(initial.summary ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const stored = savedSettings(settings);
  const payload = {
    name: name.trim(),
    template: templateFromNode(rows[0]),
    settings: stored.settings,
    defaults: stored.defaults,
    summary: summary.trim() || null,
  };
  // What's stored, put through the same conversions as the payload, so the
  // two compare equal until something is actually changed.
  const baseline = useMemo(
    () =>
      JSON.stringify({
        name: item.name,
        template: templateFromNode(nodeFromTemplate(item.template)),
        ...savedSettings(draftSettings(item.settings, item.defaults)),
        summary: item.summary,
      }),
    [item]
  );
  const dirty = JSON.stringify(payload) !== baseline;

  // A saved item is one row and what's inside it. Anything that would leave
  // two at the top — deleting the item's own row, moving a row out of it — is
  // refused here rather than saved as something that can't be placed.
  const onScope = useCallback((next: ScopeUpdate) => {
    setRows((current) => {
      const updated = typeof next === "function" ? next(current) : next;
      if (updated.length === 1) return updated;
      toast.error("A saved item is one row and what's inside it.", { id: "one-root" });
      return current;
    });
  }, []);

  const keys = stored.settings.map((def) => def.key).filter(Boolean);
  const { values } = resolveSettings(stored.settings, stored.defaults);
  const rootKey = rows[0]?.key;

  const rowExtra = (node: ScopeNode) => (
    <RowSizingEditor
      node={node}
      isRoot={node.key === rootKey}
      settingKeys={keys}
      values={values}
    />
  );

  const { actions, onRowKeyDown, overlays } = useScopeEditor({
    nodes: rows,
    onScope,
    mode: "edit",
    rowExtra,
    shortcut: false,
    // The item's own row — removing the whole item is Delete, up top.
    fixedKey: rootKey,
  });

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!payload.name) {
      setError("Give it a name.");
      return;
    }
    setError(null);
    update.mutate(
      { id: item.id, ...payload },
      {
        onSuccess: (saved) => {
          setItem(saved);
          // Once saved, a setting's formula name is fixed: formulas use it.
          setSettings((current) =>
            current.map((draft) => ({
              ...draft,
              autoKey: false,
              autoChoices: draft.autoChoices.map(() => false),
            }))
          );
          void client.invalidateQueries({ queryKey: ["saved-items"] });
          toast.success("Saved.");
          router.refresh();
        },
        onError: (cause) => setError(cause.message),
      }
    );
  }

  function confirmDelete() {
    remove.mutate(item.id, {
      onSuccess: () => {
        toast(`Deleted ${item.name} from your library`);
        router.push("/office/library");
      },
      onError: (cause) => toast.error(cause.message),
    });
  }

  const kind = NODE_SPEC[item.template.type].label;

  return (
    // **Not one form.** The row editor's buttons — add inside, the row menu —
    // are plain buttons, and inside a form every one of them would save.
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/office/library"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Library
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-muted-foreground font-label text-[10px] uppercase">
              Saved {kind.toLowerCase()} ·{" "}
              {item.timesUsed
                ? `used ${item.timesUsed} time${item.timesUsed === 1 ? "" : "s"}`
                : "not used yet"}
            </span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Name"
              className="h-11 text-lg font-semibold"
            />
          </label>
          <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
            <Trash2 />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-6 @3xl/office:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 overflow-hidden rounded-xl border">
          <div className="border-b p-5">
            <h2 className="font-label text-[11px] uppercase">Rows</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              What it puts in a quote. Edit them the way you edit rows on a
              quote; under each one, size it from the settings.
            </p>
          </div>
          <ScopeActionsProvider value={actions}>
            <div onKeyDown={onRowKeyDown}>
              <ScopeTree nodes={rows} />
            </div>
            {overlays}
          </ScopeActionsProvider>
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          <SettingsEditor drafts={settings} onChange={setSettings} />

          {stored.settings.length ? (
            <section className="flex flex-col gap-2 rounded-xl border p-5">
              <h2 className="font-label text-[11px] uppercase">On its tile</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                How the Library tab describes it. Put settings in braces; left
                empty, it lists each setting.
              </p>
              <Input
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                aria-label="Tile description"
                className="font-mono text-xs"
              />
            </section>
          ) : null}

          <Preview item={{ ...payload, source: item.source }} values={values} />
        </div>
      </div>

      <form onSubmit={save}>
        <SaveBar dirty={dirty} pending={update.isPending} error={error} />
      </form>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {item.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It leaves your library and every job&apos;s settings for it go
              with it. Quotes it was already added to keep their rows.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * What the item adds to a quote at its defaults — worked out from the rows as
 * they are on screen, so a formula's effect shows before it's saved.
 */
function Preview({
  item,
  values,
}: {
  item: Pick<SavedItem, "template" | "source">;
  values: Record<string, string | number>;
}) {
  const { node, problems } = expandSavedItem(item, values);
  const lines: { key: string; depth: number; node: ScopeNode }[] = [];
  walk([node], ({ node: row, depth }) => lines.push({ key: row.key, depth, node: row }));

  return (
    <section className="flex flex-col gap-2 rounded-xl border p-5">
      <h2 className="font-label text-[11px] uppercase">What it adds at the defaults</h2>
      <ul className="flex flex-col text-sm">
        {lines.map(({ key, depth, node: row }) => (
          <li
            key={key}
            className="flex items-baseline justify-between gap-3 border-t py-1.5"
            style={depth ? { paddingLeft: `${depth * 0.75}rem` } : undefined}
          >
            <span className="min-w-0">
              <span className={depth ? "" : "font-medium"}>
                {row.description || NODE_SPEC[row.type].label}
              </span>
              {isPriced(row) ? (
                <span className="text-muted-foreground block text-xs tabular-nums">
                  {formatQuantity(row.quantity)} {row.unit ?? ""} × {formatMoney(row.sellPriceCents)}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums">
              {isPriced(row) ? formatMoney(leafTotal(row)) : NODE_SPEC[row.type].container ? formatMoney(nodeTotal(row)) : ""}
            </span>
          </li>
        ))}
      </ul>
      {problems.length ? (
        <ul className="text-destructive flex flex-col gap-1 text-xs">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
