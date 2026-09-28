"use client";

import { reportFreeLimit } from "@/lib/membership/limit-event";

import { useEffect, useRef, useState } from "react";
import { Link2, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { DemoChip } from "@/components/demo-chip";
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
import { Textarea } from "@/components/ui/textarea";
import { quoteMessage } from "@/lib/email/words";
import { formatMoney } from "@/lib/quote";

/**
 * Screen 8 · the send · job Q4.
 *
 * **Email is the way it goes.** The product sends through Resend and nothing
 * else — texting waits on a provider cheap enough to put behind every quote —
 * so the sheet is an email: who it's to, the subject, his words, and beside
 * them the email itself, exactly as it will land. Seeing the finished email is
 * what makes pressing Send feel safe; a form with a Send button asks him to
 * imagine the result.
 *
 * **The preview is the real thing.** It is composed on the server by the same
 * function the send uses, from the quote as it stands and the words in the
 * sheet, and it redraws as he types.
 *
 * **Copying the link is the fallback, not a second front door.** It sits in the
 * footer for the customer he'd rather reach himself, and it becomes the main
 * action only where email isn't set up.
 *
 * **A demo has nowhere to type a customer.** It goes to his own sign-in address
 * — not a disabled field, no field.
 */

export type SendResult = {
  url: string;
  channel: "email" | "link";
  to: string | null;
};

type Preview = { subject: string; html: string; from: string | null };

export function QuoteSendSheet({
  open,
  onOpenChange,
  quoteId,
  customerName,
  title,
  totalCents,
  demo,
  emailEnabled,
  customerEmail,
  selfEmail,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  customerName: string;
  title: string;
  totalCents: number;
  demo: boolean;
  /** Whether this deployment can send email at all. */
  emailEnabled: boolean;
  /** The address already on the customer, if there is one. */
  customerEmail: string | null;
  /** The contractor's own sign-in address — where a demo goes. */
  selfEmail: string;
  onSent: (result: SendResult) => void;
}) {
  const first = customerName.trim().split(/\s+/)[0] || "";
  const [to, setTo] = useState(customerEmail ?? "");
  // Null until the first preview says what the quote's own subject is.
  const [subject, setSubject] = useState<string | null>(null);
  const [message, setMessage] = useState(() =>
    quoteMessage(customerName, title, demo)
  );
  const [sending, setSending] = useState<"email" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = useEmailPreview(quoteId, subject, message, (loaded) =>
    setSubject((current) => current ?? loaded)
  );

  const recipient = demo ? selfEmail : to.trim();
  const addressOk = /^\S+@\S+\.\S+$/.test(recipient);
  const canEmail =
    emailEnabled && sending === null && message.trim() !== "" && addressOk;

  async function send(channel: "email" | "link") {
    setSending(channel);
    setError(null);

    const response = await fetch(`/api/v1/quotes/${quoteId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        message: message.trim(),
        ...(channel === "email" && subject?.trim()
          ? { subject: subject.trim() }
          : {}),
        ...(!demo && channel === "email" ? { to: to.trim() } : {}),
      }),
    }).catch(() => null);

    const body = (await response?.json().catch(() => null)) as {
      data?: SendResult;
      error?: { message?: string };
    } | null;

    if (!response?.ok || !body?.data) {
      // At the Free job limit the upgrade sheet opens over the draft (§3.1).
      reportFreeLimit(body?.error);
      // The sheet stays exactly as he left it — the address, the subject, the
      // message — with one line saying what happened.
      setError(
        body?.error?.message ??
          "Couldn't reach the server. Nothing was sent — try again."
      );
      setSending(null);
      return;
    }

    const result = body.data;

    if (result.channel === "link") {
      try {
        await navigator.clipboard.writeText(`${message.trim()}\n\n${result.url}`);
        toast.success(
          demo
            ? "Link copied. Open it the way a customer would."
            : `Copied — your message and the link, ready to send${first ? ` to ${first}` : ""}.`
        );
      } catch {
        toast.message("Your link is ready", { description: result.url });
      }
    } else {
      toast.success(demo ? "Emailed to you." : `Emailed to ${result.to}.`);
    }

    onSent(result);
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (sending === null) onOpenChange(next);
      }}
    >
      <ResponsiveDialogContent desktopClassName="sm:max-w-5xl">
        <ResponsiveDialogHeader
          title={
            <span className="flex items-center gap-2">
              {demo
                ? "Email this demo to yourself"
                : first
                  ? `Email the quote to ${first}`
                  : "Email the quote"}
              {demo ? <DemoChip /> : null}
            </span>
          }
          description={
            demo
              ? "A demo goes to you and nowhere else — the same email a customer would get."
              : "From your business name. Replies come straight to you."
          }
        />

        <ResponsiveDialogBody className="grid items-start gap-6 p-0 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:gap-0">
          {/* The email's parts. */}
          <div className="flex flex-col gap-5 p-4 md:border-r md:p-5">
            {emailEnabled ? null : (
              <p className="bg-muted/50 rounded-lg border p-3 text-sm leading-relaxed">
                Email isn&apos;t set up yet, so this can&apos;t be sent from here.
                You can copy the link and send it yourself for now.
              </p>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="send-to">To</Label>
              {demo ? (
                <p className="bg-muted/40 rounded-lg border px-2.5 py-1.5 text-sm">
                  {selfEmail}
                </p>
              ) : (
                <>
                  <Input
                    id="send-to"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    disabled={!emailEnabled}
                  />
                  <p className="text-muted-foreground text-xs">
                    {customerEmail
                      ? `${first || "Their"} address, from the job.`
                      : `Kept on ${first ? `${first}'s` : "their"} record — you won't be asked again.`}
                  </p>
                </>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="send-subject">Subject</Label>
              <Input
                id="send-subject"
                value={subject ?? ""}
                onChange={(event) => setSubject(event.target.value)}
                disabled={subject === null || !emailEnabled}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="send-message">Message</Label>
              <Textarea
                id="send-message"
                rows={5}
                className="min-h-32"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                The quote&apos;s card and its link go underneath — they
                can&apos;t be left off.
              </p>
            </div>

            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </div>

          {/* What lands. */}
          <div className="bg-muted/30 flex min-w-0 flex-col gap-2 p-4 md:p-5">
            <p className="text-muted-foreground font-label text-[10px] uppercase">
              {demo ? "What you'll get" : `What ${first || "they"} will get`}
            </p>
            <div className="bg-background overflow-hidden rounded-lg border">
              <div className="flex flex-col gap-0.5 border-b px-4 py-2.5 text-xs">
                <p className="truncate">
                  <span className="text-muted-foreground">From </span>
                  {preview.data?.from ?? "Your business"}
                </p>
                <p className="truncate">
                  <span className="text-muted-foreground">To </span>
                  {recipient || (
                    <span className="text-muted-foreground">No address yet</span>
                  )}
                </p>
                <p className="truncate font-medium">
                  {subject ?? preview.data?.subject ?? ""}
                </p>
              </div>
              <EmailFrame html={preview.data?.html ?? null} busy={preview.busy} />
            </div>
          </div>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant={emailEnabled ? "ghost" : "default"}
            size={emailEnabled ? "sm" : "lg"}
            onClick={() => send("link")}
            disabled={sending !== null || message.trim() === ""}
            className={emailEnabled ? "text-muted-foreground" : undefined}
          >
            {sending === "link" ? <Loader2 className="animate-spin" /> : <Link2 />}
            {emailEnabled ? "Copy the link instead" : "Copy the link"}
          </Button>

          {emailEnabled ? (
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-muted-foreground font-label text-[10px] uppercase">
                  Quote total
                </p>
                <p className="font-semibold tabular-nums">
                  {formatMoney(totalCents)}
                </p>
              </div>
              <Button size="lg" onClick={() => send("email")} disabled={!canEmail}>
                {sending === "email" ? <Loader2 className="animate-spin" /> : <Mail />}
                {sending === "email"
                  ? "Sending…"
                  : demo
                    ? "Email it to me"
                    : "Send email"}
              </Button>
            </div>
          ) : null}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * The email, composed on the server from the quote and the sheet's words.
 *
 * Debounced, so typing doesn't send a request a keystroke, and each request
 * cancels the one before it — a slow early preview must never land on top of
 * a newer one.
 */
function useEmailPreview(
  quoteId: string,
  subject: string | null,
  message: string,
  onFirst: (subject: string) => void
) {
  const [data, setData] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(true);
  const first = useRef(onFirst);
  useEffect(() => {
    first.current = onFirst;
  });

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const response = await fetch(`/api/v1/quotes/${quoteId}/send/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: message.trim() || undefined,
            subject: subject?.trim() || undefined,
          }),
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as {
          data?: Preview;
        } | null;
        if (body?.data) {
          setData(body.data);
          first.current(body.data.subject);
        }
      } catch {
        // Aborted by a newer keystroke, or offline — the last good preview
        // stays up rather than blanking.
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [quoteId, subject, message]);

  return { data, busy };
}

/**
 * The email in a sandboxed frame, so the app's styles can't reach it and its
 * links can't navigate the app. Grown to the email's own height rather than
 * scrolling inside a scrolling sheet.
 */
function EmailFrame({ html, busy }: { html: string | null; busy: boolean }) {
  const [height, setHeight] = useState(520);

  if (!html) {
    return (
      <div className="text-muted-foreground flex h-[520px] items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Putting the email together
      </div>
    );
  }

  return (
    <iframe
      title="The email as it will arrive"
      srcDoc={html}
      sandbox="allow-same-origin"
      className="block w-full transition-opacity"
      style={{ height, opacity: busy ? 0.6 : 1 }}
      onLoad={(event) => {
        const doc = event.currentTarget.contentDocument;
        if (doc) setHeight(doc.documentElement.scrollHeight);
      }}
    />
  );
}
