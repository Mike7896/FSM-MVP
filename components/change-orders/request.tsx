"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiJson } from "@/lib/api/client";
import { MAX_ATTACHMENT_BYTES } from "@/lib/schemas/receipt";

/**
 * Asking for a change, from the customer's link — under the page, closed
 * until she wants it.
 *
 * **Asking commits her to nothing**, and the panel says so before she types:
 * the business prices the change and sends it back as its own document, which
 * she then approves or doesn't. Up to three photos, because "the outlet by the
 * back door" is a sentence that a picture settles.
 */
export function RequestChange({ token, businessName }: { token: string; businessName?: string | null }) {
  const id = useRef("");
  const uploaded = useRef(new Map<File, string>());
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const business = businessName ?? "The business";

  async function submit() {
    setBusy(true);
    setError(null);
    id.current ||= crypto.randomUUID();
    try {
      if (files.length > 3 || files.some((f) => f.size > MAX_ATTACHMENT_BYTES || !f.type.startsWith("image/"))) {
        throw new Error("Choose up to three photos, each no larger than 20 MB.");
      }
      const photoPaths: string[] = [];
      for (const file of files) {
        let path = uploaded.current.get(file);
        if (!path) {
          const slot = await apiJson<{ path: string; signedUrl: string }>(
            `/api/share/${token}/change-requests/upload`,
            "POST",
            { id: id.current, fileName: file.name }
          );
          const res = await fetch(slot.signedUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file,
          });
          if (!res.ok) throw new Error("Photo upload failed. Try again.");
          path = slot.path;
          uploaded.current.set(file, path);
        }
        photoPaths.push(path);
      }
      await apiJson(`/api/share/${token}/change-requests`, "POST", {
        id: id.current,
        body,
        photoPaths,
      });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't send your request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-background mx-4 rounded-xl border p-5 sm:mx-0 sm:p-6 print:hidden">
      {done ? (
        <div role="status">
          <h2 className="text-base font-semibold">Request sent</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            {business} will price the change and send it back for you to
            approve. Your agreement hasn&apos;t changed.
          </p>
        </div>
      ) : !open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Want something changed?</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              Ask {business}. Asking doesn&apos;t commit you to any work or
              payment.
            </p>
          </div>
          <Button variant="outline" onClick={() => setOpen(true)}>
            Ask for a change
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold">Ask for a change</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              {business} prices it and sends it back. You approve the priced
              change separately — asking commits you to nothing.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="change-request">What would you like changed?</Label>
            <Textarea
              id="change-request"
              className="min-h-28"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={busy}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="change-photos" className="flex items-center gap-1.5">
              <ImagePlus className="size-4" />
              Photos, if they help (up to three)
            </Label>
            <input
              id="change-photos"
              className="text-muted-foreground file:bg-muted file:text-foreground w-full text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm"
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !body.trim()} onClick={submit}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Send request
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Not now
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
