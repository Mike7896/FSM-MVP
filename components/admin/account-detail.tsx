"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, Check, Copy, KeyRound, Loader2, ShieldCheck, ShieldOff, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AccountRow } from "@/lib/admin/accounts";
import { cn } from "@/lib/utils";

import { Badges, short } from "./accounts-view";

type Detail = AccountRow & {
  activity: { id: number; occurredAt: string; kind: string; level: string; title: string; orgName: string | null }[];
};

/**
 * One account: who they are, how they're treated, and the three things done
 * to an account — change their settings, make them an admin, suspend them —
 * plus a new password when they've lost theirs.
 *
 * Owners are read-only here by design; the actions say why instead of hiding.
 */
export function AccountDetail({ account, me }: { account: Detail; me: string }) {
  const router = useRouter();
  const suspended = Boolean(account.policy?.bannedAt) || (account.bannedUntil !== null && new Date(account.bannedUntil) > new Date());
  const self = account.id === me;
  const [busy, setBusy] = useState<string | null>(null);
  const [suspending, setSuspending] = useState(false);
  const [password, setPassword] = useState<string | null>(null);

  async function call(label: string, url: string, init: RequestInit, done: string) {
    setBusy(label);
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { data?: unknown; error?: { message?: string } } | null;
    setBusy(null);
    if (!response?.ok) {
      toast.error(body?.error?.message ?? "That didn't work.");
      return null;
    }
    if (done) toast.success(done);
    router.refresh();
    return body?.data ?? true;
  }

  return (
    <div className="flex flex-col gap-4 p-3 md:p-5">
      <Link href="/admin/accounts" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" />
        Accounts
      </Link>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{account.name ?? account.email}</h1>
          <p className="text-muted-foreground text-sm">{account.email}</p>
          <div className="mt-2">
            <Badges account={account} />
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-muted-foreground mb-3 font-label text-[10px] uppercase">Who they are</h2>
          <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Signs in with</dt>
            <dd>{account.providers.map((p) => (p === "email" ? "Email + password" : p === "google" ? "Google" : p)).join(" · ") || "—"}</dd>
            <dt className="text-muted-foreground">Email confirmed</dt>
            <dd>{account.confirmedAt ? short(account.confirmedAt) : "No"}</dd>
            <dt className="text-muted-foreground">Joined</dt>
            <dd>{short(account.createdAt)}</dd>
            <dt className="text-muted-foreground">Last sign-in</dt>
            <dd>{short(account.lastSignInAt)}</dd>
            <dt className="text-muted-foreground">Last in the app</dt>
            <dd>{short(account.lastSeen)}</dd>
            <dt className="text-muted-foreground">Business</dt>
            <dd>{account.businesses.length ? account.businesses.map((b) => `${b.name || "Unnamed"} (${b.role})`).join(", ") : "None yet"}</dd>
            <dt className="text-muted-foreground">Plan</dt>
            <dd>{account.policy?.compPlan ? "Complimentary" : (account.plan ?? "Free")}</dd>
            <dt className="text-muted-foreground">Sent · 7 days</dt>
            <dd>{account.sends7d}</dd>
            {suspended ? (
              <>
                <dt className="text-destructive">Suspended</dt>
                <dd className="text-destructive">
                  {account.policy?.bannedAt ? short(account.policy.bannedAt) : ""}
                  {account.policy?.bannedReason ? ` — ${account.policy.bannedReason}` : ""}
                </dd>
              </>
            ) : null}
          </dl>
        </section>

        <PolicyForm account={account} onSave={(change) => call("policy", `/api/v1/admin/accounts/${account.id}`, { method: "PATCH", body: JSON.stringify(change) }, "Saved.")} busy={busy === "policy"} />
      </div>

      <section className="bg-card rounded-lg border p-4">
        <h2 className="text-muted-foreground mb-3 font-label text-[10px] uppercase">Access</h2>
        {account.owner ? (
          <p className="text-muted-foreground text-sm">
            An owner — named in ADMIN_EMAILS on the server. Owners can&apos;t be changed from the panel, so nobody can lock
            the people who run ServiceClerk out of it.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {account.admin ? (
              <Button
                variant="outline"
                size="sm"
                disabled={self || busy !== null}
                title={self ? "You can't remove your own admin access" : undefined}
                onClick={() => call("admin", `/api/v1/admin/accounts/${account.id}/admin`, { method: "PUT", body: JSON.stringify({ on: false }) }, "No longer an admin.")}
              >
                {busy === "admin" ? <Loader2 className="animate-spin" /> : <ShieldOff className="size-4" />}
                Remove admin access
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={suspended || busy !== null}
                onClick={() => call("admin", `/api/v1/admin/accounts/${account.id}/admin`, { method: "PUT", body: JSON.stringify({ on: true }) }, "Now an admin.")}
              >
                {busy === "admin" ? <Loader2 className="animate-spin" /> : <ShieldCheck className="size-4" />}
                Make an admin
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={!account.hasPassword || busy !== null}
              title={account.hasPassword ? undefined : "Signs in with Google only — there's no password to set"}
              onClick={async () => {
                const result = (await call("password", `/api/v1/admin/accounts/${account.id}/password`, { method: "POST" }, "")) as { password?: string } | null;
                if (result?.password) setPassword(result.password);
              }}
            >
              {busy === "password" ? <Loader2 className="animate-spin" /> : <KeyRound className="size-4" />}
              Set a new password
            </Button>

            {suspended ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => call("suspend", `/api/v1/admin/accounts/${account.id}/suspension`, { method: "DELETE" }, "Suspension lifted — they can sign in again.")}
              >
                {busy === "suspend" ? <Loader2 className="animate-spin" /> : <Undo2 className="size-4" />}
                Lift the suspension
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={self || busy !== null}
                onClick={() => setSuspending(true)}
              >
                <Ban className="size-4" />
                Suspend…
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="bg-card rounded-lg border p-4">
        <h2 className="text-muted-foreground mb-3 font-label text-[10px] uppercase">Recent activity</h2>
        {account.activity.length ? (
          <ul className="divide-y text-sm">
            {account.activity.map((event) => (
              <li key={event.id} className="flex items-baseline gap-3 py-1.5">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    event.level === "money" ? "bg-emerald-500" : event.level === "milestone" ? "bg-sky-500" : event.level === "problem" ? "bg-destructive" : "bg-muted-foreground"
                  )}
                />
                <span className="min-w-0 flex-1">{event.title}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{event.kind}</span>
                <span className="text-muted-foreground w-28 shrink-0 text-right text-xs">
                  {new Date(event.occurredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Nothing logged for this account yet.</p>
        )}
      </section>

      {suspending ? (
        <SuspendDialog
          email={account.email}
          onClose={() => setSuspending(false)}
          onConfirm={async (reason) => {
            const ok = await call("suspend", `/api/v1/admin/accounts/${account.id}/suspension`, { method: "PUT", body: JSON.stringify({ reason }) }, "Suspended — they're signed out and can't sign back in.");
            if (ok) setSuspending(false);
          }}
          busy={busy === "suspend"}
        />
      ) : null}

      {password ? <PasswordShown email={account.email} password={password} onClose={() => setPassword(null)} /> : null}
    </div>
  );
}

function PolicyForm({
  account,
  onSave,
  busy,
}: {
  account: Detail;
  onSave: (change: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const policy = account.policy;
  const [tester, setTester] = useState(policy?.kind === "tester");
  const [comp, setComp] = useState(policy?.compPlan ?? false);
  const [until, setUntil] = useState(policy?.accessUntil ?? "");
  const [limit, setLimit] = useState(policy?.dailySendLimit === null || policy?.dailySendLimit === undefined ? "" : String(policy.dailySendLimit));
  const [note, setNote] = useState(policy?.note ?? "");

  return (
    <form
      className="bg-card flex flex-col gap-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          kind: tester ? "tester" : "standard",
          compPlan: comp,
          accessUntil: until || null,
          dailySendLimit: limit === "" ? null : Number(limit),
          note: note.trim() || null,
        });
      }}
    >
      <h2 className="text-muted-foreground font-label text-[10px] uppercase">How they&apos;re treated</h2>
      <label className="flex items-start gap-3 text-sm">
        <Checkbox checked={tester} onCheckedChange={(checked) => setTester(checked === true)} className="mt-0.5" />
        <span>
          Tester
          <span className="text-muted-foreground block text-xs">Someone trying ServiceClerk. Access can end on a date.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <Checkbox checked={comp} onCheckedChange={(checked) => setComp(checked === true)} className="mt-0.5" />
        <span>
          Complimentary plan
          <span className="text-muted-foreground block text-xs">Treated as paying, charged nothing.</span>
        </span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="policy-until">Access until</Label>
          <Input id="policy-until" type="date" value={until} onChange={(event) => setUntil(event.target.value)} />
          <p className="text-muted-foreground text-xs">Suspended automatically the day after.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="policy-limit">Sends a day</Label>
          <Input id="policy-limit" type="number" min={0} max={1000} value={limit} onChange={(event) => setLimit(event.target.value)} />
          <p className="text-muted-foreground text-xs">Quotes, contracts and invoices. Blank, no cap.</p>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="policy-note">Note</Label>
        <Textarea id="policy-note" rows={2} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
      </div>
      <Button type="submit" size="sm" className="self-start" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        Save
      </Button>
    </form>
  );
}

function SuspendDialog({
  email,
  onClose,
  onConfirm,
  busy,
}: {
  email: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suspend {email}?</DialogTitle>
          <DialogDescription>
            They&apos;re signed out everywhere at once and can&apos;t sign back in. Their business and records stay exactly as
            they are, and lifting it is one click.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="suspend-reason">Why</Label>
          <Input id="suspend-reason" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
          <p className="text-muted-foreground text-xs">Kept with the suspension and shown here.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>
            {busy ? <Loader2 className="animate-spin" /> : <Ban className="size-4" />}
            Suspend
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordShown({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New password for {email}</DialogTitle>
          <DialogDescription>Copy it now — it isn&apos;t shown again. Their old password no longer works.</DialogDescription>
        </DialogHeader>
        <pre className="bg-muted rounded-md p-3 text-center font-mono text-lg tracking-wider">{password}</pre>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(password).then(() => setCopied(true))}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
