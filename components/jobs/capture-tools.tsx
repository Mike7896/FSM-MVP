"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Camera, Loader2, PencilLine, Ruler } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { uploadJobPhoto } from "@/lib/captures/upload";
import { cn } from "@/lib/utils";

type Written = "note" | "measurement";

/**
 * The capture tools on a job — photo, note, measurement — each one saving
 * straight onto the job the moment it's taken.
 *
 * **Everything lands on the Job, not a quote**, which is what lets a
 * walkthrough happen before any pricing has started. The quote editor shows the
 * same captures beside the quote written from them.
 *
 * Photos use the one upload path every photo on a job takes (`uploadJobPhoto`).
 * On a phone the picker offers the camera as well as the library, so a photo
 * taken on site goes straight on.
 *
 * Voice recording is deliberately absent: it needs a consent step that knows
 * the job's jurisdiction, and a dead Record button would be worse than none.
 */
export function CaptureTools({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<Written | null>(null);
  const [text, setText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  function addPhotos(files: FileList | null) {
    const images = [...(files ?? [])].filter((file) =>
      file.type.startsWith("image/")
    );
    if (images.length === 0) return;

    setUploading(true);
    startTransition(async () => {
      try {
        // One at a time: several multi-megabyte uploads at once over a phone
        // connection is how all of them fail together.
        for (const file of images) await uploadJobPhoto(jobId, file);
        toast.success(
          images.length === 1
            ? "Photo added to the job."
            : `${images.length} photos added to the job.`
        );
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't add that.");
      } finally {
        setUploading(false);
      }
    });
  }

  function toggle(kind: Written) {
    setOpen((current) => (current === kind ? null : kind));
    setText("");
  }

  function save() {
    const body = text.trim();
    if (!open || !body) return;
    const kind = open;

    startTransition(async () => {
      const response = await fetch(`/api/v1/jobs/${jobId}/captures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, body }),
      });

      if (!response.ok) {
        toast.error(
          kind === "note"
            ? "Couldn't save that note."
            : "Couldn't save that measurement."
        );
        return;
      }

      toast.success(kind === "note" ? "Note added." : "Measurement added.");
      setText("");
      setOpen(null);
      router.refresh();
    });
  }

  function choose(tool: "photo" | Written) {
    if (tool === "photo") fileInput.current?.click();
    else toggle(tool);
  }

  const tools = [
    {
      id: "photo" as const,
      label: "Photo",
      icon: uploading ? Loader2 : Camera,
      hint: "Take one, or pick from your phone",
      expanded: undefined,
    },
    {
      id: "note" as const,
      label: "Note",
      icon: PencilLine,
      hint: "What you saw, or what the customer said",
      expanded: open === "note",
    },
    {
      id: "measurement" as const,
      label: "Measure",
      icon: Ruler,
      hint: "A length, a count, a size",
      expanded: open === "measurement",
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {tools.map((tool) => (
          <Button
            key={tool.id}
            type="button"
            variant="outline"
            disabled={tool.id === "photo" && uploading}
            aria-expanded={tool.expanded}
            onClick={() => choose(tool.id)}
            className={cn(
              "h-auto flex-col items-start gap-1 p-4 text-left whitespace-normal",
              tool.expanded && "border-primary bg-primary/[0.03]"
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <tool.icon
                className={cn(
                  "size-4",
                  tool.id === "photo" && uploading && "animate-spin"
                )}
              />
              {tool.label}
            </span>
            <span className="text-muted-foreground text-xs font-normal">
              {tool.hint}
            </span>
          </Button>
        ))}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          addPhotos(event.target.files);
          event.target.value = "";
        }}
      />

      {open ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="flex flex-col gap-2 rounded-lg border p-4"
        >
          {open === "note" ? (
            <Textarea
              autoFocus
              rows={3}
              value={text}
              maxLength={4000}
              aria-label="Note"
              placeholder="What's worth remembering?"
              className="resize-none"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                // Enter saves, Shift+Enter breaks the line — a note is a
                // thought to get down, not a document.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  save();
                }
              }}
            />
          ) : (
            <Input
              autoFocus
              value={text}
              maxLength={4000}
              aria-label="Measurement"
              placeholder="What you measured, and how much"
              onChange={(event) => setText(event.target.value)}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => toggle(open)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !text.trim()}>
              {open === "note" ? "Save the note" : "Save the measurement"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
