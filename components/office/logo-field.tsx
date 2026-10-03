"use client";

import { useRef, useState, type DragEvent } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

async function call<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(parsed?.error?.message ?? "That didn't work. Try again.");
  }
  return parsed?.data as T;
}

/**
 * The business's logo: pick a file (or drop one), and it's on the Office.
 *
 * The file goes straight from the browser to Storage on a one-time upload
 * URL, then the Office is pointed at it — the same two steps as the logo
 * offer after a quote is sent.
 */
export function LogoField({
  logoUrl,
  onChange,
}: {
  logoUrl: string | null;
  /** The new public URL, or null once removed. */
  onChange: (logoUrl: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setError(null);
    if (!TYPES.includes(file.type)) {
      setError("Use a PNG, JPG or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That image is over 5 MB. Try a smaller one.");
      return;
    }

    setBusy("upload");
    try {
      const slot = await call<{ path: string; signedUrl: string }>(
        "/api/v1/office/logo",
        "POST",
        { fileName: file.name }
      );

      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", file);
      const put = await fetch(slot.signedUrl, { method: "PUT", body: form });
      if (!put.ok) throw new Error("The upload didn't go through. Try again.");

      const row = await call<{ logoUrl: string | null }>(
        "/api/v1/office/logo",
        "PUT",
        { path: slot.path }
      );
      onChange(row.logoUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't add your logo.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setError(null);
    setBusy("remove");
    try {
      await call("/api/v1/office/logo", "DELETE");
      onChange(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't remove it.");
    } finally {
      setBusy(null);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  return (
    <div className="grid gap-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-wrap items-center gap-4 rounded-lg border border-dashed p-3 transition-colors",
          dragging && "border-ring bg-muted/50"
        )}
      >
        <div className="bg-muted/40 flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the business's own uploaded image, any size
            <img
              src={logoUrl}
              alt="Your logo"
              className="max-h-full max-w-full object-contain p-1.5"
            />
          ) : (
            <ImageUp className="text-muted-foreground size-5" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => input.current?.click()}
            >
              {busy === "upload" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ImageUp />
              )}
              {logoUrl ? "Replace" : "Upload logo"}
            </Button>
            {logoUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={remove}
                className="text-muted-foreground hover:text-destructive"
              >
                {busy === "remove" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Trash2 />
                )}
                Remove
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            PNG, JPG or WebP, up to 5 MB. Or drop a file here.
          </p>
        </div>

        <input
          ref={input}
          type="file"
          accept={TYPES.join(",")}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
