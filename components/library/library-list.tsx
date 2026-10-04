"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import {
  FILTER_LABEL,
  KIND_ICON,
  SORTS,
  filterOf,
  sortItems,
  type Filter,
  type Sort,
} from "@/components/quote-editor/library/library-panel";
import { useLibraryMutations } from "@/components/quote-editor/library/use-library";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  describeSavedItem,
  savedItemText,
  templateFromNode,
  type SavedItem,
} from "@/lib/library";
import { NODE_SPEC, makeNode, type NodeType } from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * Every saved item, as a list to find one in and open.
 *
 * **A list, not tiles.** The quote editor's tiles are for picking something up
 * and dragging it; here the job is finding the one to change, and a list reads
 * name, kind, settings and use in one line each.
 */
export function LibraryList({ items }: { items: SavedItem[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);

  const filters = useMemo(() => {
    const present = new Set(items.map((item) => filterOf(item.template.type)));
    return (Object.keys(FILTER_LABEL) as Exclude<Filter, "all">[]).filter((key) =>
      present.has(key)
    );
  }, [items]);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return sortItems(
      items.filter(
        (item) =>
          (filter === "all" || filterOf(item.template.type) === filter) &&
          (!term || savedItemText(item).includes(term))
      ),
      sort
    );
  }, [items, query, filter, sort]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your library"
            aria-label="Search your library"
            className="pl-8"
          />
        </div>
        <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
          <SelectTrigger className="w-auto" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {SORTS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          New item
        </Button>
      </div>

      {filters.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </Chip>
          {filters.map((key) => (
            <Chip key={key} active={filter === key} onClick={() => setFilter(key)}>
              {FILTER_LABEL[key]}
            </Chip>
          ))}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm leading-relaxed">
          <p className="text-foreground font-medium">Nothing saved yet.</p>
          <p className="mt-1">
            Save a row from any quote — open its menu and choose “Save to
            library” — or start one here with New item.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing in your library matches that.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {shown.map((item) => (
            <li key={item.id}>
              <Row item={item} />
            </li>
          ))}
        </ul>
      )}

      {creating ? <NewItemDialog onOpenChange={setCreating} /> : null}
    </section>
  );
}

function Row({ item }: { item: SavedItem }) {
  const Icon = KIND_ICON[item.template.type];
  const settings = item.settings.length;
  return (
    <Link
      href={`/office/library/${item.id}`}
      className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition-colors"
    >
      <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.name}</span>
        <span className="text-muted-foreground block truncate text-xs tabular-nums">
          {describeSavedItem(item, item.defaults)}
        </span>
      </span>
      <span className="text-muted-foreground hidden shrink-0 text-right text-xs sm:block">
        <span className="block">
          {settings
            ? `${settings} setting${settings === 1 ? "" : "s"}`
            : NODE_SPEC[item.template.type].label}
        </span>
        <span className="block">
          {item.timesUsed
            ? `Used ${item.timesUsed} time${item.timesUsed === 1 ? "" : "s"}`
            : "Not used yet"}
        </span>
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </Link>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        active
          ? "border-foreground/40 bg-foreground/5 text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

const KINDS: { type: NodeType; blurb: string }[] = [
  { type: "item", blurb: "One priced row." },
  { type: "assembly", blurb: "Parts and labor sold as one line." },
  { type: "group", blurb: "A heading that holds rows — a room, an area." },
];

/** A new item from nothing: a name and what kind of row it is. Its rows and settings come next, on its own page. */
function NewItemDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { create } = useLibraryMutations(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<NodeType>("assembly");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, template: templateFromNode(makeNode(type, { description: trimmed })) },
      {
        onSuccess: (item) => router.push(`/office/library/${item.id}`),
        onError: (error) => toast.error(error.message),
      }
    );
  }

  return (
    <ResponsiveDialog open onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <form onSubmit={submit}>
          <ResponsiveDialogHeader
            title="New library item"
            description="Name it and pick what kind of row it is. You'll add its rows and settings next."
          />
          <ResponsiveDialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-item-name">Name</Label>
              <Input
                id="new-item-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              {KINDS.map((kind) => {
                const Icon = KIND_ICON[kind.type];
                const selected = type === kind.type;
                return (
                  <button
                    key={kind.type}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setType(kind.type)}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      selected ? "border-primary/60 bg-primary/[0.04]" : "hover:bg-muted/60"
                    )}
                  >
                    <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    <span>
                      <span className="block text-sm font-medium">{NODE_SPEC[kind.type].label}</span>
                      <span className="text-muted-foreground block text-xs">{kind.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "Creating…" : "Create and open"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
