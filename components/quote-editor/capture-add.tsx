"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type DragEvent } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { uploadJobPhoto } from "@/lib/captures/upload";
import { cn } from "@/lib/utils";

/**
 * Getting things into the capture panel from the desk.
 *
 * **This is not the capture surface.** Capturing is a native-app job — notes,
 * photographs, measurements, audio and work that has to queue when the signal
 * drops are not adequately servable in a browser, and the walkthrough is
 * central to the product rather than peripheral. Building the real one here
 * would be building the wrong thing.
 *
 * What the desk genuinely needs is an **intake**: the contractor photographed
 * the panel on their phone, the files are in a folder, and they are about to
 * write the quote. Dropping them beside the editor is desk work, and until the
 * native app exists it is the only way the panel is ever non-empty. It is also
 * how a customer's emailed photographs get onto the job.
 *
 * **The file goes straight to Storage and the row is written after it lands.**
 * A walkthrough's photographs run to tens of megabytes, so routing them through
 * the app server buys nothing but a timeout — and a row written first is a
 * thumbnail that never loads.
 */
export function CaptureAdd({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | null) {
    const images = [...(files ?? [])].filter((file) =>
      file.type.startsWith("image/")
    );
    if (images.length === 0) return;

    startTransition(async () => {
      try {
        // Sequential rather than parallel: a walkthrough is twenty photographs
        // and twenty concurrent multi-megabyte PUTs is how a phone tethering
        // connection drops all of them at once.
        for (const file of images) await uploadJobPhoto(jobId, file);
        toast.success(
          images.length === 1
            ? "Added to the visit."
            : `${images.length} photos added to the visit.`
        );
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't add that."
        );
      }
    });
  }

  function addNote() {
    const text = note.trim();
    if (!text) return;

    startTransition(async () => {
      const response = await fetch(`/api/v1/jobs/${jobId}/captures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "note", body: text }),
      });

      if (!response.ok) {
        toast.error("Couldn't save that note.");
        return;
      }

      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t p-3">
      <div
        onDragOver={(event: DragEvent) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center transition-colors",
          dragging && "border-primary bg-primary/[0.04]"
        )}
      >
        {pending ? (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        ) : (
          <ImagePlus className="text-muted-foreground size-4" />
        )}
        <p className="text-muted-foreground text-xs leading-relaxed">
          Drop photos from the visit here, or{" "}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="text-primary-ink underline underline-offset-4"
          >
            choose files
          </button>
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <Textarea
        rows={2}
        value={note}
        placeholder="Or type what she said…"
        className="resize-none text-sm"
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          // Enter commits, Shift+Enter breaks the line. A note is one sentence
          // he wants out of his head, not a document.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            addNote();
          }
        }}
      />

      {note.trim() ? (
        <Button size="sm" onClick={addNote} disabled={pending}>
          Add the note
        </Button>
      ) : null}
    </div>
  );
}
