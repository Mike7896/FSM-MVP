"use client";

import { useState } from "react";
import { CalendarPlus, Link2, Loader2, Mail, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AccountRow } from "@/lib/admin/accounts";
import { addMonths, daysBetween, extendFrom, freeTimeEnd, freeTimeOpenEnded, today } from "@/lib/admin/free-time";
import { INVITE_NOTE_MAX } from "@/lib/schemas/admin";
import { cn } from "@/lib/utils";

import { InviteSent, longDate, NoteHint, type Sent } from "./invite-dialog";

/**
 * What an admin does with an invite after it's sent — founder-led sales is
 * people forgetting, typos, and promises that change:
 *
 * - **Resend** with a new link, the address corrected and the note rewritten.
 * - **Withdraw** an invite nobody used, freeing the address.
 * - **Free Pro time** — add a few months, or set the last day outright.
 */

/* ── Resend ──────────────────────────────────────────────────────────── */

export function ResendInviteDialog({ account, onClose, onDone }: { account: AccountRow; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(account.email);
  const [message, setMessage] = useState(account.invite?.message ?? "");
  const [busy, setBusy] = useState<"email" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const end = freeTimeEnd(account.policy);

  async function resend(send: boolean) {
    setBusy(send ? "email" : "link");
    setError(null);
    const changed = email.trim().toLowerCase() !== account.email.toLowerCase();
    const response = await fetch(`/api/v1/admin/accounts/${account.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ send, ...(changed ? { email: email.trim() } : {}), message: message.trim() || null }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { data?: Sent; error?: { message?: string; details?: { message?: string }[] } } | null;
    setBusy(null);
    if (!response?.ok || !body?.data) {
      const details = body?.error?.details;
      setError((Array.isArray(details) ? details[0]?.message : null) ?? body?.error?.message ?? "That didn't work.");
      return;
    }
    setSent(body.data);
    onDone();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="size-5 text-amber-500" />
            {sent ? (sent.emailed ? "New invite sent" : "New invite link") : "Resend the invite"}
          </DialogTitle>
          <DialogDescription>
            {sent
              ? sent.emailed
                ? `It's in ${sent.email}'s inbox. The previous link no longer works.`
                : "The previous link no longer works."
              : "A new link, good for two weeks. The one they have now stops working."}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <InviteSent sent={sent} />
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void resend(true);
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="resend-email">Their email</Label>
              <Input id="resend-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
              <p className="text-muted-foreground text-xs">Wrong address the first time? Fix it here — the account moves to the new one.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="resend-message">
                A note from you <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="resend-message"
                rows={3}
                maxLength={INVITE_NOTE_MAX}
                className="max-h-72"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <NoteHint length={message.length} />
            </div>
            {end ? (
              <p className="text-muted-foreground text-xs">
                Their free Pro runs through {longDate(end)}
                {end < today() ? " — that's already past" : ""}. Add time from their account if the wait cost them some.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy !== null}>
                Cancel
              </Button>
              <Button type="button" variant="outline" disabled={busy !== null || !email.trim()} onClick={() => void resend(false)}>
                {busy === "link" ? <Loader2 className="animate-spin" /> : <Link2 className="size-4" />}
                Just get the link
              </Button>
              <Button type="submit" disabled={busy !== null || !email.trim()}>
                {busy === "email" ? <Loader2 className="animate-spin" /> : <Mail className="size-4" />}
                Email the new link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Withdraw ────────────────────────────────────────────────────────── */

export function WithdrawInviteDialog({ email, busy, onClose, onConfirm }: { email: string; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw {email}&apos;s invite?</DialogTitle>
          <DialogDescription>
            Their link stops working and the unused account is deleted, along with what you&apos;d set aside for them — free
            time, founding pricing. You can invite this address again any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 className="size-4" />}
            Withdraw the invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Free Pro time ───────────────────────────────────────────────────── */

const ADD = [1, 2, 3, 6] as const;

/**
 * The free period at a glance, and more of it in two clicks. Added months
 * count from the current last day, or from today once it's passed. Saving
 * turns the complimentary plan on and, if they've already chosen a plan,
 * moves its first charge to the day after.
 */
export function FreeTimeCard({ account, busy, onSave }: { account: AccountRow; busy: boolean; onSave: (until: string) => void }) {
  const policy = account.policy;
  const now = today();
  const end = freeTimeEnd(policy);
  const openEnded = freeTimeOpenEnded(policy);
  const tester = policy?.kind === "tester";
  const [choice, setChoice] = useState<number | "date">(openEnded ? "date" : 1);
  const [date, setDate] = useState("");
  const from = extendFrom(policy, now);
  const until = choice === "date" ? date || null : addMonths(from, choice);
  const what = tester && !policy?.compPlan ? "Tester access" : "Free Pro";

  return (
    <section className="bg-card flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-muted-foreground font-label text-[10px] uppercase">Free Pro time</h2>
      <p className="text-sm">
        {openEnded
          ? "Free Pro, with no end date."
          : end && end >= now
            ? `${what} through ${longDate(end)}`
            : end
              ? `${what} ended ${longDate(end)}.`
              : "No free time right now."}
        {!openEnded && end && end >= now ? (
          <span className="text-muted-foreground"> · {end === now ? "last day today" : `${daysBetween(now, end)} days left`}</span>
        ) : null}
      </p>

      <div className="bg-muted flex flex-wrap gap-0.5 rounded-lg p-0.5">
        {[...(openEnded ? [] : ADD), "date" as const].map((entry) => (
          <button
            key={entry}
            type="button"
            aria-pressed={choice === entry}
            onClick={() => setChoice(entry)}
            className={cn(
              "flex-1 rounded-md px-2.5 py-1 text-sm whitespace-nowrap",
              choice === entry ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {entry === "date" ? "Pick a date" : `+${entry} month${entry === 1 ? "" : "s"}`}
          </button>
        ))}
      </div>
      {choice === "date" ? (
        <Input type="date" aria-label="Last free day" value={date} min={now} onChange={(event) => setDate(event.target.value)} />
      ) : null}

      <p className="text-muted-foreground text-xs">
        {until
          ? `New last day: ${longDate(until)}${
              choice === "date" ? "" : end && end >= now ? ` — ${choice} more after ${longDate(end)}.` : ` — ${choice} month${choice === 1 ? "" : "s"} from today.`
            }`
          : "Choose their last free day."}
        {account.plan === "trialing" ? " They've chosen a plan, so its first charge moves to the day after." : ""}
        {tester ? " Their tester access runs to the same day." : ""}
      </p>
      {account.plan === "active" ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          They&apos;re paying already — free time doesn&apos;t pause or refund their subscription.
        </p>
      ) : null}

      <Button size="sm" className="self-start" disabled={busy || !until || until < now || until === end} onClick={() => until && onSave(until)}>
        {busy ? <Loader2 className="animate-spin" /> : <CalendarPlus className="size-4" />}
        {choice === "date" ? "Set the last day" : "Add the time"}
      </Button>
    </section>
  );
}
