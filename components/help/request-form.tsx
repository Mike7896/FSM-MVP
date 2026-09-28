"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SUPPORT_KINDS, supportKind, type SupportKind } from "@/lib/support/types";
import { cn } from "@/lib/utils";

import { sendSupportRequest } from "./send-support";

/** Big enough for a phone screenshot, small enough to send quickly. */
const MAX_SCREENSHOT = 8 * 1024 * 1024;

/**
 * One form for all three: a problem, an idea, or a request for a person.
 *
 * **Asks only what we can't find out ourselves.** The page they were on, their
 * browser, who they are and which business — all of that comes with it. What's
 * left is the one line and the story, which only they know.
 *
 * **Says where the answer will come.** Their sign-in address is shown before
 * they send, not discovered after: a reply that goes somewhere they don't
 * read is no reply.
 */
export function RequestForm({
  initialKind,
  page,
  name,
  email,
}: {
  initialKind: SupportKind;
  page: string | null;
  name: string | null;
  email: string;
}) {
  const [kind, setKind] = useState<SupportKind>(initialKind);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recording, setRecording] = useState(true);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ number: number } | null>(null);

  const copy = supportKind(kind);
  const ready = subject.trim().length > 0 && body.trim().length > 0;

  async function send() {
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      const saved = await sendSupportRequest({
        kind,
        subject: subject.trim(),
        body: body.trim(),
        page,
        name,
        email,
        includeReplay: kind === "bug" && recording,
        screenshot: kind === "bug" ? screenshot : null,
      });
      setSent({ number: saved.number });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't send. Try again in a moment.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-xl border p-6">
        <CheckCircle2 className="size-8 text-emerald-500" />
        <div>
          <p className="text-lg font-semibold tracking-tight">Got it — request {sent.number}.</p>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            A person reads every one. We&apos;ll answer by email at{" "}
            <span className="text-foreground font-medium">{email}</span>
            {kind === "idea" ? " if we have a question — and it goes on the list either way." : "."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/help">Back to Help</Link>
          </Button>
          {page ? (
            <Button asChild variant="ghost">
              <Link href={page}>Back to where you were</Link>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="sr-only">What kind of request</legend>
        {SUPPORT_KINDS.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            aria-pressed={kind === entry.kind}
            onClick={() => setKind(entry.kind)}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left transition-colors",
              kind === entry.kind
                ? "border-primary bg-primary/10"
                : "hover:bg-muted/50"
            )}
          >
            <span className="block text-sm font-medium">{entry.label}</span>
            <span className="text-muted-foreground block text-xs leading-snug">{entry.lead}</span>
          </button>
        ))}
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="support-subject">{copy.subjectLabel}</Label>
        <Input
          id="support-subject"
          value={subject}
          maxLength={140}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="support-body">{copy.bodyLabel}</Label>
        <Textarea
          id="support-body"
          rows={7}
          className="min-h-36"
          value={body}
          maxLength={5000}
          onChange={(event) => setBody(event.target.value)}
        />
        <p className="text-muted-foreground text-xs">{copy.bodyHint}</p>
      </div>

      {kind === "bug" ? (
        <div className="flex flex-col gap-4 rounded-lg border p-4">
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <Checkbox
              checked={recording}
              onCheckedChange={(checked) => setRecording(checked === true)}
              className="mt-0.5"
            />
            <span>
              Include a recording of the last minute
              <span className="text-muted-foreground block text-xs leading-relaxed">
                What you clicked and what the page did, so we can see it happen. Text and images on
                screen are blanked out in it.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            {screenshot ? (
              <span className="bg-muted flex min-w-0 items-center gap-2 rounded-md px-2 py-1">
                <ImagePlus className="text-muted-foreground size-4 shrink-0" />
                <span className="truncate">{screenshot.name}</span>
                <button
                  type="button"
                  aria-label="Remove the screenshot"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setScreenshot(null)}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ) : (
              <label className="hover:bg-muted/50 inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5">
                <ImagePlus className="size-4" />
                Add a screenshot
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file && file.size > MAX_SCREENSHOT) {
                      setError("That image is over 8 MB. A smaller screenshot will do.");
                      return;
                    }
                    setError(null);
                    setScreenshot(file);
                  }}
                />
              </label>
            )}
            <span className="text-muted-foreground text-xs">Optional</span>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-xs leading-relaxed">
          We&apos;ll answer by email at <span className="text-foreground">{email}</span>.
          {page ? (
            <>
              {" "}
              The page you were on (<span className="text-foreground">{page}</span>) comes with it.
            </>
          ) : null}
        </p>
        <Button type="submit" disabled={!ready || sending} className="shrink-0">
          {sending ? <Loader2 className="animate-spin" /> : null}
          {copy.action}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
}
