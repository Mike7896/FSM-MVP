"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerNoteItem } from "@/lib/queries/customers";

/**
 * The customer's notes log — what was said, when, and by whom.
 *
 * Newest first, because the last thing anyone wrote is what the next person
 * to call them needs. Only the shop sees these; nothing a customer reads
 * prints one.
 */
export function CustomerNotes({
  customerId,
  notes,
  viewerId,
  canManage,
}: {
  customerId: string;
  notes: CustomerNoteItem[];
  /** Who is looking — they can remove what they wrote. */
  viewerId: string;
  /** Owners and admins can remove anyone's note. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  // A note is removed on the second press, so a stray tap can't erase one.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function add(event: React.FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;

    startSaving(async () => {
      setError(null);
      const response = await fetch(`/api/v1/customers/${customerId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      }).catch(() => null);

      if (!response?.ok) {
        const result = (await response?.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(result?.error?.message ?? "Couldn't save that note.");
        return;
      }

      setBody("");
      router.refresh();
    });
  }

  async function remove(noteId: string) {
    if (confirmingId !== noteId) {
      setConfirmingId(noteId);
      return;
    }
    setConfirmingId(null);
    setRemovingId(noteId);
    const response = await fetch(
      `/api/v1/customers/${customerId}/notes/${noteId}`,
      { method: "DELETE" }
    ).catch(() => null);
    setRemovingId(null);

    if (!response?.ok) {
      const result = (await response?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      toast.error(result?.error?.message ?? "Couldn't remove that note.");
      return;
    }
    router.refresh();
  }

  return (
    <section>
      <p className="text-muted-foreground mb-2 font-label text-[11px] uppercase">
        Notes
      </p>

      <form onSubmit={add} className="flex flex-col gap-2">
        <Textarea
          aria-label="Add a note about this customer"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              add(event);
            }
          }}
          maxLength={2000}
          rows={2}
          className="min-h-16"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : (
              "Only your team sees notes."
            )}
          </p>
          <Button type="submit" size="sm" disabled={saving || !body.trim()}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            Add note
          </Button>
        </div>
      </form>

      {notes.length > 0 ? (
        <ol className="mt-4 flex flex-col">
          {notes.map((note) => {
            const removable = canManage || note.createdBy === viewerId;
            return (
              <li key={note.id} className="group flex gap-3 border-t py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {note.body}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    <LocalTime iso={new Date(note.createdAt).toISOString()} />
                    {note.authorName ? ` · ${note.authorName}` : ""}
                  </p>
                </div>
                {removable && confirmingId === note.id ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-7 shrink-0"
                    autoFocus
                    onBlur={() => setConfirmingId(null)}
                    onClick={() => remove(note.id)}
                  >
                    Remove
                  </Button>
                ) : removable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive size-7 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    aria-label="Remove this note"
                    disabled={removingId === note.id}
                    onClick={() => remove(note.id)}
                  >
                    {removingId === note.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <X />
                    )}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
