"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { CheckCircle2, Loader2, RotateCcw, TriangleAlert } from "lucide-react";

import { sendSupportRequest } from "@/components/help/send-support";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * When a page in the app breaks.
 *
 * **Says what happened and what it means** (Content Design §4): the page hit an
 * error, what was already saved is safe, and here's how to get going again.
 *
 * **And asks the one question only they can answer** — what were you doing?
 * The error itself is already on its way to Sentry; the answer is sent as
 * feedback tied to that exact error, with the recording of the last minute, so
 * the report arrives with the crash and the story together.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const eventId = useRef<string | null>(null);
  const [story, setStory] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    eventId.current = Sentry.captureException(error);
  }, [error]);

  async function send() {
    if (!story.trim() || sending) return;
    setSending(true);
    setProblem(null);
    try {
      const saved = await sendSupportRequest({
        kind: "bug",
        subject: `A page broke: ${pathname}`,
        body: [story.trim(), error.digest ? `Error reference: ${error.digest}` : null]
          .filter(Boolean)
          .join("\n\n"),
        page: pathname,
        includeReplay: true,
        associatedEventId: eventId.current,
      });
      setSent(saved.number);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : "That didn't send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-6">
      <div className="flex flex-col gap-3">
        <TriangleAlert className="text-destructive size-7" />
        <h1 className="text-2xl font-semibold tracking-tight">This page hit an error</h1>
        <p className="text-muted-foreground leading-relaxed">
          Anything you&apos;d already saved is safe. Try the page again — if it happens twice, the
          problem is ours, and it&apos;s already been reported.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={reset}>
            <RotateCcw className="size-4" />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Go to the dashboard</Link>
          </Button>
        </div>
      </div>

      <div className="rounded-xl border p-5">
        {sent ? (
          <p className="flex items-start gap-3 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            <span>
              Thanks — that&apos;s request {sent}, sent with the error. We&apos;ll answer by email if we
              need to know more.
            </span>
          </p>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <Label htmlFor="error-story">What were you doing when it happened?</Label>
            <Textarea
              id="error-story"
              rows={3}
              value={story}
              maxLength={4000}
              onChange={(event) => setStory(event.target.value)}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                Sent with the error and a recording of the last minute, text blanked out.
              </p>
              <Button type="submit" variant="outline" size="sm" disabled={!story.trim() || sending}>
                {sending ? <Loader2 className="animate-spin" /> : null}
                Send
              </Button>
            </div>
            {problem ? (
              <p role="alert" className="text-destructive text-sm">
                {problem}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
