"use client";

import { useMemo, useState, type DragEvent } from "react";
import {
  Ban,
  FolderOpen,
  Layers,
  ReceiptText,
  Search,
  StickyNote,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  describeSavedItem,
  resolveSettings,
  savedItemText,
  templateHeight,
  type JobItemSettings,
  type SavedItem,
} from "@/lib/library";
import { NODE_SPEC, type NodeType } from "@/lib/quote";
import { cn } from "@/lib/utils";

/** The type a drag from a tile carries. Scope accepts only this. */
export const SAVED_ITEM_DRAG = "application/x-serviceclerk-saved-item";

/**
 * The tile being dragged. A drag's data can only be read on drop, so Scope
 * reads how deep the item runs from here while it decides where it would land.
 */
export const libraryDrag: { current: { id: string; height: number } | null } = {
  current: null,
};

export const KIND_ICON: Record<NodeType, LucideIcon> = {
  item: ReceiptText,
  allowance: WalletCards,
  assembly: Layers,
  group: FolderOpen,
  note: StickyNote,
  assumption: StickyNote,
  exclusion: Ban,
};

type Sort = "recent" | "used" | "name" | "newest";

const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: "Recently used" },
  { value: "used", label: "Most used" },
  { value: "name", label: "Name" },
  { value: "newest", label: "Newest" },
];

/** The filter a kind falls under. Text rows share one. */
type Filter = "all" | "item" | "group" | "assembly" | "text";

function filterOf(type: NodeType): Exclude<Filter, "all"> {
  if (type === "item" || type === "allowance") return "item";
  if (type === "group" || type === "assembly") return type;
  return "text";
}

const FILTER_LABEL: Record<Exclude<Filter, "all">, string> = {
  item: "Line items",
  group: "Groups",
  assembly: "Assemblies",
  text: "Notes",
};

function sortItems(items: SavedItem[], sort: Sort): SavedItem[] {
  const sorted = [...items];
  switch (sort) {
    case "name":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "newest":
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "used":
      return sorted.sort(
        (a, b) => b.timesUsed - a.timesUsed || a.name.localeCompare(b.name)
      );
    case "recent":
      // Never used sorts after used, newest saved first among them.
      return sorted.sort(
        (a, b) =>
          (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") ||
          b.createdAt.localeCompare(a.createdAt)
      );
  }
}

/**
 * The Library tab — the Office's saved rows, groups and assemblies, as tiles.
 *
 * At the desk a tile is dragged into Scope; anywhere, clicking it opens its
 * details, where it can be added with a button and its settings changed.
 */
export function LibraryPanel({
  items,
  loading,
  error,
  available,
  jobSettings,
  draggable,
  onOpen,
}: {
  items: SavedItem[];
  loading: boolean;
  error: string | null;
  /** False before there is an Office to keep a Library in. */
  available: boolean;
  jobSettings: JobItemSettings;
  /** Tiles drag into Scope — at the desk, where Scope is beside them. */
  draggable: boolean;
  onOpen: (item: SavedItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [filter, setFilter] = useState<Filter>("all");

  const filters = useMemo(() => {
    const present = new Set(items.map((item) => filterOf(item.template.type)));
    return (Object.keys(FILTER_LABEL) as Exclude<Filter, "all">[]).filter((key) =>
      present.has(key)
    );
  }, [items]);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matching = items.filter(
      (item) =>
        (filter === "all" || filterOf(item.template.type) === filter) &&
        (!term || savedItemText(item).includes(term))
    );
    return sortItems(matching, sort);
  }, [items, query, filter, sort]);

  if (!available) {
    return (
      <Message title="Your library opens once you have an Office.">
        Saved line items, groups and assemblies are kept with your business,
        so they need somewhere to live first.
      </Message>
    );
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 px-4 py-6 text-sm">
        <Spinner className="size-4" />
        Opening your library
      </div>
    );
  }

  if (error) {
    return <Message title="Your library didn't load.">{error}</Message>;
  }

  if (items.length === 0) {
    return (
      <Message title="Nothing saved yet.">
        Open the menu on any row in Scope and choose “Save to library” to keep
        a line item, group or assembly here.
        {draggable
          ? " Then drag it into Scope on any quote."
          : " Then add it to any quote from here."}
      </Message>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your library"
            aria-label="Search your library"
            className="h-8 pl-8 text-sm"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1">
            {filters.length > 1 ? (
              <>
                <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
                  All
                </FilterChip>
                {filters.map((key) => (
                  <FilterChip
                    key={key}
                    active={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {FILTER_LABEL[key]}
                  </FilterChip>
                ))}
              </>
            ) : null}
          </div>

          <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
            <SelectTrigger size="sm" className="h-7 w-auto shrink-0 gap-1 border-0 px-2 text-xs shadow-none" aria-label="Sort by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SORTS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-xs">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin]">
        {shown.length ? (
          <ul className="grid grid-cols-2 gap-2.5">
            {shown.map((item) => (
              <li key={item.id}>
                <SavedItemTile
                  item={item}
                  jobValues={jobSettings[item.id] ?? null}
                  draggable={draggable}
                  onOpen={() => onOpen(item)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-1 py-4 text-sm">
            Nothing in your library matches that.
          </p>
        )}
        {draggable && shown.length ? (
          <p className="text-muted-foreground mt-3 px-1 text-xs leading-relaxed">
            Drag a tile into Scope, or onto a group to put it inside.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SavedItemTile({
  item,
  jobValues,
  draggable,
  onOpen,
}: {
  item: SavedItem;
  jobValues: Record<string, string | number> | null;
  draggable: boolean;
  onOpen: () => void;
}) {
  const Icon = KIND_ICON[item.template.type];
  const { values, from } = resolveSettings(item.settings, item.defaults, jobValues);
  const overridden = Object.values(from).includes("job");
  const subheading = describeSavedItem(item, values);

  function onDragStart(event: DragEvent<HTMLButtonElement>) {
    event.dataTransfer.setData(SAVED_ITEM_DRAG, item.id);
    event.dataTransfer.setData("text/plain", item.name);
    event.dataTransfer.effectAllowed = "copy";
    libraryDrag.current = { id: item.id, height: templateHeight(item.template) };
  }

  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={() => {
        libraryDrag.current = null;
      }}
      onClick={onOpen}
      aria-label={`${item.name} — ${subheading}`}
      title={draggable ? "Drag into Scope, or click for details" : undefined}
      className={cn(
        "bg-card hover:border-foreground/30 group/tile flex w-full flex-col overflow-hidden rounded-lg border text-left transition-colors",
        draggable && "cursor-grab active:cursor-grabbing"
      )}
    >
      <span className="bg-muted/50 flex aspect-[4/3] w-full items-center justify-center border-b">
        {item.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element --
             Images come from wherever an item's author keeps them, with no
             known dimensions. */
          <img src={item.imageUrl} alt="" className="size-full object-cover" />
        ) : (
          <Icon className="text-muted-foreground size-7" aria-hidden />
        )}
      </span>
      <span className="flex flex-col gap-0.5 p-2.5">
        <span className="line-clamp-2 text-[13px] leading-snug font-medium">
          {item.name}
        </span>
        <span className="text-muted-foreground line-clamp-2 text-xs leading-snug tabular-nums">
          {subheading}
        </span>
        {overridden ? (
          <span className="text-primary-ink mt-1 font-label text-[9px] uppercase">
            This job&apos;s settings
          </span>
        ) : null}
        <span className="sr-only">{NODE_SPEC[item.template.type].label}</span>
      </span>
    </button>
  );
}

function FilterChip({
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
        "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
        active
          ? "border-foreground/40 bg-foreground/5 text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground px-4 py-5 text-sm leading-relaxed">
      <p className="text-foreground font-medium">{title}</p>
      <p className="mt-2 text-xs">{children}</p>
    </div>
  );
}
