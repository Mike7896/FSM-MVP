"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, FlaskConical, Loader2, Search, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AccountFilter, AccountRow } from "@/lib/admin/accounts";
import { cn } from "@/lib/utils";

/**
 * Accounts — every person with a sign-in, and the door to making a test one.
 *
 * Filters and the search live in the address, so "all testers" is a link.
 */

const FILTERS: { filter: AccountFilter; label: string }[] = [
  { filter: "all", label: "Everyone" },
  { filter: "admins", label: "Admins" },
  { filter: "testers", label: "Testers" },
  { filter: "suspended", label: "Suspended" },
];

export function AccountsView({ accounts, filter, q }: { accounts: AccountRow[]; filter: AccountFilter; q: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [typed, setTyped] = useState(q);
  const [creating, setCreating] = useState(false);

  function go(next: { filter?: AccountFilter; q?: string }) {
    const search = new URLSearchParams(params);
    if (next.filter !== undefined) {
      if (next.filter === "all") search.delete("filter");
      else search.set("filter", next.filter);
    }
    if (next.q !== undefined) {
      if (next.q) search.set("q", next.q);
      else search.delete("q");
    }
    router.push(`${pathname}${search.size ? `?${search}` : ""}`);
  }

  return (
    <div className="flex flex-col gap-4 p-3 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Accounts</h1>
        <span className="text-muted-foreground text-sm">{accounts.length} shown</span>
        <Button className="ml-auto" size="sm" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" />
          Create test account
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-56 flex-1 sm:max-w-sm"
          onSubmit={(event) => {
            event.preventDefault();
            go({ q: typed.trim() });
          }}
        >
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            type="search"
            aria-label="Search accounts"
            placeholder="Email, name or business"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="h-8 pl-8"
          />
        </form>
        <div className="bg-muted flex rounded-lg p-0.5">
          {FILTERS.map((entry) => (
            <button
              key={entry.filter}
              type="button"
              aria-pressed={filter === entry.filter}
              onClick={() => go({ filter: entry.filter })}
              className={cn(
                "rounded-md px-3 py-1 text-sm",
                filter === entry.filter ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              {["Account", "Signs in with", "Business", "Plan", "Status", "Sent · 7d", "Last sign-in", "Joined"].map((head) => (
                <th key={head} className="px-3 py-2 font-normal whitespace-nowrap">{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-muted-foreground px-3 py-8 text-center">No account matches that.</td>
              </tr>
            ) : (
              accounts.map((account) => (
                <tr key={account.id} className="hover:bg-muted/40 border-t">
                  <td className="px-3 py-2">
                    <Link href={`/admin/accounts/${account.id}`} className="block min-w-0 hover:underline">
                      <span className="block max-w-72 truncate font-medium">{account.name ?? account.email}</span>
                      {account.name ? <span className="text-muted-foreground block max-w-72 truncate text-xs">{account.email}</span> : null}
                    </Link>
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-xs whitespace-nowrap">{providers(account)}</td>
                  <td className="px-3 py-2 text-xs">
                    {account.businesses.length ? account.businesses.map((business) => business.name || "Unnamed").join(", ") : <span className="text-muted-foreground">None yet</span>}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {account.policy?.compPlan ? "Complimentary" : (account.plan ?? <span className="text-muted-foreground">Free</span>)}
                  </td>
                  <td className="px-3 py-2">
                    <Badges account={account} />
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">{account.sends7d}</td>
                  <td className="text-muted-foreground px-3 py-2 text-xs whitespace-nowrap">{short(account.lastSignInAt)}</td>
                  <td className="text-muted-foreground px-3 py-2 text-xs whitespace-nowrap">{short(account.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {creating ? <CreateTestAccount onClose={() => setCreating(false)} onCreated={() => router.refresh()} /> : null}
    </div>
  );
}

export function Badges({ account }: { account: AccountRow }) {
  const suspended = Boolean(account.policy?.bannedAt) || (account.bannedUntil !== null && new Date(account.bannedUntil) > new Date());
  return (
    <span className="flex flex-wrap gap-1">
      {account.owner ? <Badge tone="violet">Owner</Badge> : account.admin ? <Badge tone="violet">Admin</Badge> : null}
      {account.policy?.kind === "tester" ? <Badge tone="sky">Tester{account.policy.accessUntil ? ` · to ${account.policy.accessUntil}` : ""}</Badge> : null}
      {account.policy?.dailySendLimit !== null && account.policy?.dailySendLimit !== undefined ? (
        <Badge tone="muted">{account.policy.dailySendLimit}/day</Badge>
      ) : null}
      {suspended ? <Badge tone="red">Suspended</Badge> : null}
      {!account.confirmedAt ? <Badge tone="amber">Email unconfirmed</Badge> : null}
    </span>
  );
}

function Badge({ tone, children }: { tone: "violet" | "sky" | "red" | "amber" | "muted"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap",
        tone === "violet" && "bg-violet-500/15 text-violet-600 dark:text-violet-400",
        tone === "sky" && "bg-sky-500/15 text-sky-600 dark:text-sky-400",
        tone === "red" && "bg-destructive/15 text-destructive",
        tone === "amber" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        tone === "muted" && "bg-muted text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

function providers(account: AccountRow) {
  const names = account.providers.map((provider) => (provider === "email" ? "Email + password" : provider === "google" ? "Google" : provider));
  return names.length ? names.join(" · ") : "—";
}

export function short(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

/* ── Making a test account ─────────────────────────────────────────── */

function CreateTestAccount({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [accessUntil, setAccessUntil] = useState("");
  const [limit, setLimit] = useState("");
  const [compPlan, setCompPlan] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/v1/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        fullName: fullName.trim() || null,
        password: password || null,
        accessUntil: accessUntil || null,
        dailySendLimit: limit === "" ? null : Number(limit),
        compPlan,
        note: note.trim() || null,
      }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      data?: { email: string; password: string };
      error?: { message?: string; details?: { message?: string }[] };
    } | null;
    setBusy(false);
    if (!response?.ok || !body?.data) {
      setError(body?.error?.details?.[0]?.message ?? body?.error?.message ?? "That didn't work.");
      return;
    }
    setMade({ email: body.data.email, password: body.data.password });
    onCreated();
  }

  const message = made
    ? `Here's your ServiceClerk test account.\n\nSign in at ${window.location.origin}/login\nEmail: ${made.email}\nPassword: ${made.password}\n\nChange the password any time under Account.`
    : "";

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="size-5 text-sky-500" />
            {made ? "Test account ready" : "Create a test account"}
          </DialogTitle>
          <DialogDescription>
            {made
              ? "Copy it now — the password isn't shown again. You can always set a new one from the account."
              : "An email-and-password account for someone trying ServiceClerk. They go through setup like any new customer."}
          </DialogDescription>
        </DialogHeader>

        {made ? (
          <div className="flex flex-col gap-3">
            <pre className="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap">{message}</pre>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(message).then(() => {
                  setCopied(true);
                  toast.success("Copied — paste it into a text or email.");
                });
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy the sign-in details"}
            </Button>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="tester-email">Their email</Label>
              <Input id="tester-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
              <p className="text-muted-foreground text-xs">It&apos;s their sign-in. It doesn&apos;t have to be a real inbox — no confirmation email is sent.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tester-name">
                Their name <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="tester-name" value={fullName} maxLength={120} onChange={(event) => setFullName(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tester-password">
                Password <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="tester-password" type="text" autoComplete="off" value={password} minLength={10} onChange={(event) => setPassword(event.target.value)} />
              <p className="text-muted-foreground text-xs">Leave it blank and a strong one is made for you.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="tester-until">
                  Access until <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input id="tester-until" type="date" value={accessUntil} onChange={(event) => setAccessUntil(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tester-limit">
                  Sends a day <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input id="tester-limit" type="number" min={0} max={1000} value={limit} onChange={(event) => setLimit(event.target.value)} />
              </div>
            </div>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={compPlan} onCheckedChange={(checked) => setCompPlan(checked === true)} className="mt-0.5" />
              <span>
                Complimentary plan
                <span className="text-muted-foreground block text-xs">Treated as paying, charged nothing.</span>
              </span>
            </label>
            <div className="grid gap-1.5">
              <Label htmlFor="tester-note">
                Note <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea id="tester-note" rows={2} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !email.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck className="size-4" />}
                Create the account
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
