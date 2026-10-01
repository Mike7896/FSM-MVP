"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tags, Plus, Settings2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
import { TAG_COLORS, tagIds, type Tag, type TagEntity } from "@/lib/tags";

export function TagBadges({ tags }: { tags: Tag[] }) {
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5 py-1">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium text-foreground"
          style={{
            borderColor: `${TAG_COLORS[tag.color]}50`,
            backgroundColor: `${TAG_COLORS[tag.color]}14`,
          }}
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: TAG_COLORS[tag.color] }}
          />
          <span className="truncate">{tag.name}</span>
        </span>
      ))}
    </span>
  );
}

async function request<T>(
  org: string,
  method: string,
  body: unknown,
  assignment = false,
): Promise<T> {
  const response = await fetch(
    `/api/v1/tags${assignment ? "/assignments" : ""}`,
    {
      method,
      headers: { "Content-Type": "application/json", "X-Organization-Id": org },
      body: JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message ?? "Could not save tags. Try again.");
  return result.data;
}

export function TagManager({
  organizationId,
  tags,
  onChange,
}: {
  organizationId: string;
  tags: Tag[];
  onChange: (tags: Tag[]) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<Tag["color"]>("blue");
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reset = () => {
    setEditing(null);
    setName("");
    setColor("blue");
    setError("");
  };
  async function save() {
    setBusy(true);
    setError("");
    try {
      const tag = await request<Tag>(
        organizationId,
        editing ? "PATCH" : "POST",
        { ...(editing ? { id: editing } : {}), name, color },
      );
      onChange(
        [...tags.filter((t) => t.id !== tag.id), tag].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      reset();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      await request(organizationId, "DELETE", { id: deleting.id });
      onChange(tags.filter((t) => t.id !== deleting.id));
      if (editing === deleting.id) reset();
      setDeleting(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) {
          setOpen(v);
          setDeleting(null);
          reset();
        }
      }}
    >
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Settings2 className="size-3.5" />
        Manage tags
      </Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage tags</DialogTitle>
          <DialogDescription>
            Shared across your jobs, quotes, and customers. Renaming or changing
            a color updates it everywhere.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3 rounded-xl border bg-muted/30 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="grid gap-2 text-sm font-medium">
            {editing ? "Edit tag" : "Create a tag"}
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              required
              placeholder="e.g. High priority"
              disabled={busy}
            />
          </label>
          <fieldset disabled={busy}>
            <legend className="mb-2 text-xs text-muted-foreground">
              Color
            </legend>
            <div className="flex flex-wrap gap-2">
              {Object.entries(TAG_COLORS).map(([key, hex]) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`${key} color`}
                  aria-pressed={key === color}
                  onClick={() => setColor(key as Tag["color"])}
                  className={`size-7 rounded-full border-2 transition ${key === color ? "border-foreground ring-2 ring-background ring-offset-2 ring-offset-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !name.trim()} type="submit">
              {busy ? "Saving…" : editing ? "Save changes" : "Create tag"}
            </Button>
            {editing && (
              <Button
                disabled={busy}
                type="button"
                variant="ghost"
                size="sm"
                onClick={reset}
              >
                Cancel edit
              </Button>
            )}
          </div>
        </form>
        <div className="max-h-64 overflow-y-auto divide-y">
          {tags.length ? (
            tags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <TagBadges tags={[tag]} />
                <div className="flex shrink-0">
                  <Button
                    disabled={busy}
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${tag.name}`}
                    onClick={() => {
                      setEditing(tag.id);
                      setName(tag.name);
                      setColor(tag.color);
                      setDeleting(null);
                      setError("");
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    disabled={busy}
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${tag.name}`}
                    onClick={() => setDeleting(tag)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              Create your first tag to organize your work.
            </p>
          )}
        </div>
        {deleting && (
          <div className="space-y-2 rounded-lg border border-destructive/40 p-3">
            <p className="text-sm">
              Delete “{deleting.name}”? This removes it from every record. Your
              records stay intact.
            </p>
            <div className="flex gap-2">
              <Button
                disabled={busy}
                variant="destructive"
                size="sm"
                onClick={() => void remove()}
              >
                Delete tag everywhere
              </Button>
              <Button
                disabled={busy}
                variant="ghost"
                size="sm"
                onClick={() => setDeleting(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RecordTags({
  organizationId,
  entity,
  recordId,
  available,
  selected,
}: {
  organizationId: string;
  entity: TagEntity;
  recordId: string;
  available: Tag[];
  selected: Tag[];
}) {
  const router = useRouter();
  const [tags, setTags] = useState(available);
  const [lastAvailable, setLastAvailable] = useState(available);
  if (lastAvailable !== available) {
    setLastAvailable(available);
    setTags(available);
  }
  const [ids, setIds] = useState(selected.map((t) => t.id));
  const selectionKey = selected.map((t) => t.id).join(",");
  const [lastSelection, setLastSelection] = useState(selectionKey);
  if (lastSelection !== selectionKey) {
    setLastSelection(selectionKey);
    setIds(selected.map((t) => t.id));
  }
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle(tag: Tag) {
    const assigned = !ids.includes(tag.id);
    setBusy(true);
    setError("");
    try {
      await request(
        organizationId,
        "PUT",
        { entity, recordId, tagId: tag.id, assigned },
        true,
      );
      setIds((previous) =>
        assigned
          ? [...previous, tag.id]
          : previous.filter((id) => id !== tag.id),
      );
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="mr-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Tags className="size-3.5" />
        Tags
      </span>
      <TagBadges tags={tags.filter((t) => ids.includes(t.id))} />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Plus className="size-3.5" />
            {ids.length ? "Edit tags" : "Add tags"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start">
          <Input
            aria-label="Find tags"
            placeholder="Find a tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-60 overflow-y-auto">
            {tags
              .filter((t) =>
                t.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((tag) => (
                <label
                  key={tag.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={ids.includes(tag.id)}
                    onChange={() => void toggle(tag)}
                  />
                  <TagBadges tags={[tag]} />
                </label>
              ))}
            {!tags.some((t) =>
              t.name.toLowerCase().includes(search.toLowerCase()),
            ) && (
              <p className="p-2 text-xs text-muted-foreground">
                {tags.length
                  ? "No tags match your search."
                  : "Create a tag below to get started."}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <TagManager
            organizationId={organizationId}
            tags={tags}
            onChange={setTags}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function TagFilters({
  organizationId,
  available,
}: {
  organizationId: string;
  available: Tag[];
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [tags, setTags] = useState(available);
  const [lastAvailable, setLastAvailable] = useState(available);
  if (lastAvailable !== available) {
    setLastAvailable(available);
    setTags(available);
  }
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();
  const ids = tagIds(params.get("tags") ?? undefined);
  const mode = params.get("tagMode") ?? "any";
  function update(nextIds: string[], nextMode = mode) {
    const next = new URLSearchParams(params.toString());
    next.delete("offset");
    if (nextIds.length && nextMode !== "untagged")
      next.set("tags", nextIds.join(","));
    else next.delete("tags");
    if (nextMode !== "any" || nextIds.length) next.set("tagMode", nextMode);
    else next.delete("tagMode");
    startTransition(() =>
      router.push(`${path}?${next.toString()}`, { scroll: false }),
    );
  }
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3"
      aria-busy={pending}
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Tags className="size-3.5" />
            Filter tags{ids.length > 0 ? ` · ${ids.length}` : ""}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start">
          <Input
            aria-label="Search filter tags"
            placeholder="Find a tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-64 overflow-y-auto">
            {tags
              .filter((t) =>
                t.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((tag) => (
                <label
                  key={tag.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    disabled={
                      pending || (ids.length >= 20 && !ids.includes(tag.id))
                    }
                    checked={ids.includes(tag.id)}
                    onChange={() =>
                      update(
                        ids.includes(tag.id)
                          ? ids.filter((id) => id !== tag.id)
                          : [...ids, tag.id],
                        mode === "untagged" ? "any" : mode,
                      )
                    }
                  />
                  <TagBadges tags={[tag]} />
                </label>
              ))}
            {!tags.length && (
              <p className="p-2 text-sm text-muted-foreground">
                No tags yet. Use Manage tags to create one.
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <select
        aria-label="Tag matching"
        disabled={pending}
        value={mode}
        onChange={(e) => update(ids, e.target.value)}
        className="h-8 rounded-md border border-input bg-card px-2 text-xs"
      >
        <option value="any">Match any tag</option>
        <option value="all">Match all tags</option>
        <option value="untagged">Untagged only</option>
      </select>
      <TagBadges tags={tags.filter((t) => ids.includes(t.id))} />
      {(params.get("tags") || mode === "untagged") && (
        <Button
          disabled={pending}
          variant="ghost"
          size="sm"
          onClick={() => update([], "any")}
        >
          Clear filters
        </Button>
      )}
      <span className="ml-auto">
        <TagManager
          organizationId={organizationId}
          tags={tags}
          onChange={setTags}
        />
      </span>
    </div>
  );
}
