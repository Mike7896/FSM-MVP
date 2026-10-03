"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Loader2, Mail, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Inviting someone — a real account, set up with what they've been promised,
 * and an email that gets them from their inbox to their own business in a
 * couple of minutes. The link comes back too, for a text message.
 */

type Sent = { userId: string; email: string; link: string; expiresAt: string; emailed: boolean; emailError: string | null };

const FREE: { value: string; label: string; months: number | null }[] = [
  { value: "none", label: "No", months: null },
  { value: "1", label: "1 month", months: 1 },
  { value: "3", label: "3 months", months: 3 },
  { value: "6", label: "6 months", months: 6 },
  { value: "12", label: "A year", months: 12 },
  { value: "date", label: "Until…", months: null },
];

export function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [founding, setFounding] = useState(false);
  const [free, setFree] = useState("none");
  const [until, setUntil] = useState("");
  const [message, setMessage] = useState("");
  const [send, setSend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  const freeUntil = free === "date" ? until || null : monthsFromToday(FREE.find((entry) => entry.value === free)?.months ?? null);

  async function invite() {
    setBusy(true);
    setError(null);
    setExisting(null);
    const response = await fetch("/api/v1/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        fullName: fullName.trim() || null,
        founding,
        freeUntil,
        message: message.trim() || null,
        send,
      }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      data?: Sent;
      error?: { message?: string; details?: { message?: string; userId?: string }[] | { userId?: string } };
    } | null;
    setBusy(false);
    if (!response?.ok || !body?.data) {
      const details = body?.error?.details;
      setError((Array.isArray(details) ? details[0]?.message : null) ?? body?.error?.message ?? "That didn't work.");
      const userId = Array.isArray(details) ? details[0]?.userId : details?.userId;
      if (userId) setExisting(userId);
      return;
    }
    setSent(body.data);
    onInvited();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="size-5 text-amber-500" />
            {sent ? (sent.emailed ? "Invite sent" : "Account ready") : "Invite someone"}
          </DialogTitle>
          <DialogDescription>
            {sent
              ? sent.emailed
                ? `It's in ${sent.email}'s inbox. They accept, choose a password and set up their business.`
                : sent.emailError ? "The account was created, but the invite email was not sent." : "The account was created. Share the invite link so they can finish setting it up."
              : "A real account for a contractor, emailed to them. They accept, choose a password and set up their business."}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <InviteSent sent={sent} />
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void invite();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="invite-email">Their email</Label>
                <Input id="invite-email" type="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="invite-name">
                  Their name <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input id="invite-name" value={fullName} maxLength={120} onChange={(event) => setFullName(event.target.value)} />
              </div>
            </div>

            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={founding} onCheckedChange={(checked) => setFounding(checked === true)} className="mt-0.5" />
              <span>
                Founding member
                <span className="text-muted-foreground block text-xs">
                  Founding prices when they subscribe, kept as long as they stay — even if the public offer is closed or full.
                </span>
              </span>
            </label>

            <div className="grid gap-1.5">
              <Label>Free Pro access</Label>
              <div className="bg-muted flex flex-wrap gap-0.5 rounded-lg p-0.5">
                {FREE.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    aria-pressed={free === entry.value}
                    onClick={() => setFree(entry.value)}
                    className={cn(
                      "flex-1 rounded-md px-2.5 py-1 text-sm whitespace-nowrap",
                      free === entry.value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              {free === "date" ? (
                <Input type="date" aria-label="Free until" value={until} min={monthsFromToday(0) ?? undefined} onChange={(event) => setUntil(event.target.value)} />
              ) : null}
              <p className="text-muted-foreground text-xs">
                {freeUntil
                  ? `Everything in Pro, charged nothing, through ${longDate(freeUntil)}. After that they're on Free until they subscribe.`
                  : "None: they start on Free, with the usual 14-day pack trials, and subscribe when they're ready."}
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="invite-message">
                A note from you <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="invite-message"
                rows={3}
                maxLength={1000}
                placeholder="Hey Igor — here's the app I told you about. Would love your honest take."
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">Goes at the top of the email. Their replies come to you.</p>
            </div>

            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={send} onCheckedChange={(checked) => setSend(checked === true)} className="mt-0.5" />
              <span>
                Email the invite
                <span className="text-muted-foreground block text-xs">Off: the account is made and you get the link to send yourself.</span>
              </span>
            </label>

            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}{" "}
                {existing ? (
                  <Link href={`/admin/accounts/${existing}`} className="underline underline-offset-2">
                    Open their account
                  </Link>
                ) : null}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !email.trim() || (free === "date" && !until)}>
                {busy ? <Loader2 className="animate-spin" /> : <Send className="size-4" />}
                {send ? "Send the invite" : "Create the account"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The link, and a message around it to paste into a text. */
export function InviteSent({ sent }: { sent: Pick<Sent, "userId" | "email" | "link" | "expiresAt" | "emailed" | "emailError"> }) {
  const [copied, setCopied] = useState<"link" | "text" | null>(null);
  const localLink = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/])/i.test(sent.link);
  const text = `Here's your invite to ServiceClerk — tap to set up your account:\n${sent.link}`;
  const copy = (what: "link" | "text", value: string) =>
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(what);
      toast.success("Copied.");
    });

  return (
    <div className="flex flex-col gap-3">
      {sent.emailError ? (
        <p role="alert" className="text-destructive rounded-md border border-current/30 p-2.5 text-sm">
          Email not sent. {sent.emailError} The account is saved; you don’t need to create it again.
        </p>
      ) : null}
      {localLink && <p role="alert" className="text-destructive text-sm">This is a local development link. It will not work on the recipient’s device. Configure the public app URL and generate a new invite before sharing it.</p>}
      <pre className="bg-muted rounded-md p-3 text-xs break-all whitespace-pre-wrap">{sent.link}</pre>
      <p className="text-muted-foreground text-xs">
        Works once, until {longDate(sent.expiresAt.slice(0, 10))}. Sending a new one from their account stops this one.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => copy("link", sent.link)}>
          {copied === "link" ? <Check className="size-4" /> : <Copy className="size-4" />}
          Copy link
        </Button>
        <Button variant="outline" size="sm" onClick={() => copy("text", text)}>
          {copied === "text" ? <Check className="size-4" /> : <Copy className="size-4" />}
          Copy as a text message
        </Button>
        <Button asChild variant="ghost" size="sm" className="ml-auto">
          <Link href={`/admin/accounts/${sent.userId}`}>Open their account</Link>
        </Button>
      </div>
    </div>
  );
}

/** Today plus some months, as the "YYYY-MM-DD" a date column takes — on this computer's calendar. */
function monthsFromToday(months: number | null) {
  if (months === null) return null;
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function longDate(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
