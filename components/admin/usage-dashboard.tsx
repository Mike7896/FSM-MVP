"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Gauge, Plus, RefreshCw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { defaultProviders, headroom, providerUsageSchema, type SavedProvider, type LiveUsage, type UsageMetric } from "@/lib/admin/usage-model";

const number = (v: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(v);
const money = (v: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency }).format(v);
const inputClass = "bg-background w-full min-w-0 rounded-md border px-3 py-2 text-sm";
const billingLinks: Record<string, string> = { vercel: "https://vercel.com/dashboard", supabase: "https://supabase.com/dashboard", resend: "https://resend.com/overview" };

function Meter({ metric, factor = 1, unlimited = false }: { metric: UsageMetric; factor?: number; unlimited?: boolean }) {
  const used = metric.used === null ? null : metric.used * factor;
  const room = headroom(used, metric.limit);
  const color = room && (room.excess > 0 || room.percent >= 90) ? "bg-rose-500" : room && room.percent >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
      <span className="min-w-0 break-words font-medium">{metric.name}</span>
      <span className="text-muted-foreground text-xs tabular-nums">{used === null ? "Not reported" : `${number(used)} ${metric.unit}`} / {unlimited ? "no cap" : metric.limit === null ? "limit unset" : `${number(metric.limit)} ${metric.unit}`}</span>
    </div>
    <div className="bg-muted h-1.5 overflow-hidden rounded-full" role={room ? "meter" : undefined} aria-label={`${metric.name} allowance used`} aria-valuemin={room ? 0 : undefined} aria-valuemax={room ? 100 : undefined} aria-valuenow={room ? Math.min(100, room.percent) : undefined} aria-valuetext={room ? `${number(room.percent)}% used` : undefined}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${room ? Math.min(100, room.percent) : 0}%` }} />
    </div>
    <p className="text-muted-foreground text-xs">{unlimited ? "No cap reported for this window." : room ? room.excess > 0 ? `${number(room.excess)} ${metric.unit} above ${metric.behavior === "hard" ? "the hard limit" : metric.behavior === "overage" ? "the included allowance" : "the reference threshold"}` : `${number(room.remaining)} ${metric.unit} remaining · ${number(room.percent)}% used` : "Add usage and a limit to see headroom."}{metric.behavior === "overage" && room?.excess ? " Additional charges may apply." : ""}</p>
  </div>;
}

export function UsageDashboard({ initial }: { initial: SavedProvider[] }) {
  const [providers, setProviders] = useState(initial);
  const [editing, setEditing] = useState<SavedProvider | null>(null);
  const [factor, setFactor] = useState(1);
  const today = new Date().toISOString().slice(0, 10);
  const liveQuery = useQuery<LiveUsage[]>({
    queryKey: ["admin", "provider-usage"],
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await fetch("/api/v1/admin/usage/live", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Could not refresh provider usage.");
      return body.data;
    },
  });
  const live = liveQuery.data ?? [];
  const loading = liveQuery.isFetching;
  const liveError = liveQuery.isError ? "Provider usage could not be refreshed. Try again." : "";
  const refresh = () => { void liveQuery.refetch(); };
  const current = providers.filter((p) => p.updatedAt && p.start <= today && today < p.end && p.asOf <= today);
  const reported = current.filter((p) => p.reported !== null);
  const currencies = [...new Set(reported.map((p) => p.currency))];
  const tracked = current.flatMap((p) => p.metrics).filter((m) => m.used !== null && m.limit !== null);
  const attention = tracked.filter((m) => { const r = headroom(m.used, m.limit); return r && (r.percent >= 80 || r.excess > 0); });
  return <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-widest">Platform operations</p><h1 className="text-3xl font-semibold tracking-tight">Costs & Usage</h1><p className="text-muted-foreground mt-2 max-w-xl text-sm">What it costs to run ServiceClerk, and how much room is left to grow.</p></div>
      <Button variant="outline" onClick={() => setEditing({ ...defaultProviders()[0], id: `provider-${crypto.randomUUID().slice(0, 8)}`, name: "", scope: "", metrics: [] })}><Plus className="size-4" />Add provider</Button>
    </header>
    <section className="grid gap-4 sm:grid-cols-3" aria-label="Cost and capacity summary">
      <Summary label="Reported spend" value={currencies.length ? currencies.map((c) => money(reported.filter((p) => p.currency === c).reduce((s, p) => s + (p.reported ?? 0), 0), c)).join(" + ") : "Not entered"} detail={`${reported.length} of ${providers.length} providers · active billing periods`} />
      <Summary label="Allowances to watch" value={tracked.length ? `${attention.length} near the limit` : "No limits tracked"} detail="80% or more used · saved observations" />
      <Summary label="Usage coverage" value={`${tracked.length} metrics`} detail={`${current.length} providers with a current saved period`} />
    </section>
    <div className="bg-muted/35 rounded-xl border p-4 text-sm"><span className="font-medium">Start with your provider bills.</span> <span className="text-muted-foreground">Add each plan, billing period, costs and allowances. Prices and limits are unset until you enter them. Reported spend is the total cost so far for that period; recurring fees are shown separately and never added twice. Periods may differ across providers.</span></div>
    <section className="space-y-4" aria-label="Provider costs and headroom">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Provider headroom</h2><p className="text-muted-foreground text-sm">Saved figures from your provider dashboards.</p></div><label className="flex flex-wrap items-center gap-3 text-xs"><span>Usage scenario <strong className="tabular-nums">{factor.toFixed(1)}×</strong></span><input className="accent-emerald-600" type="range" min="1" max="5" step="0.1" value={factor} onChange={(e) => setFactor(Number(e.target.value))} aria-label="Usage growth multiplier" /></label></div>
      {factor > 1 && <p className="text-muted-foreground text-xs">Scenario multiplies the saved usage only. It is not a month-end forecast or a cost estimate; allowances and costs stay unchanged.</p>}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {providers.map((p) => {
          const active = current.some((c) => c.id === p.id);
          return <article key={p.id} className="bg-card min-w-0 overflow-hidden rounded-xl border">
            <div className="flex items-start justify-between gap-3 border-b p-5"><div className="min-w-0"><h3 className="truncate text-lg font-semibold">{p.name}</h3><p className="text-muted-foreground mt-1 text-xs">{p.plan || "Plan not set"} · {p.scope}</p></div><Button variant="ghost" size="sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}><Settings2 className="size-4" />Edit</Button></div>
            <div className="space-y-5 p-5">
              <div className="grid grid-cols-2 gap-4"><div><p className="text-muted-foreground text-xs">Reported spend</p><p className="mt-1 text-2xl font-semibold tabular-nums">{p.reported === null ? "—" : money(p.reported, p.currency)}</p></div><div><p className="text-muted-foreground text-xs">Recurring fee / period</p><p className="mt-1 text-2xl font-semibold tabular-nums">{p.recurring === null ? "—" : money(p.recurring, p.currency)}</p></div></div>
              <div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs"><span>{p.updatedAt ? `${p.start} → ${p.end} (end exclusive)` : "Billing period not confirmed"}</span><span className={p.updatedAt && !active ? "text-amber-600" : ""}>{!p.updatedAt ? "Needs setup" : !active ? "Outside current period / future observation" : `Observed ${p.asOf}`}</span></div>
              {p.metrics.map((m, i) => <Meter key={i} metric={m} factor={factor} />)}
              {!p.metrics.length && <p className="text-muted-foreground text-sm">Add the usage metrics that matter for this service.</p>}
              {p.notes && <p className="text-muted-foreground whitespace-pre-wrap break-words text-xs">{p.notes}</p>}
            </div>
            <footer className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-xs"><span>{p.updatedAt ? `Manual · saved ${p.updatedAt.slice(0, 10)}` : "No figures entered"}</span>{billingLinks[p.id] && <a className="hover:text-foreground inline-flex items-center gap-1" href={billingLinks[p.id]} target="_blank" rel="noreferrer">Provider dashboard<ArrowUpRight className="size-3" /></a>}</footer>
          </article>;
        })}
      </div>
    </section>
    <section className="space-y-4" aria-label="Live provider readings">
      <div className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Direct from providers</h2><p className="text-muted-foreground text-sm">Read-only API readings, separate from your saved cost records.</p></div><Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />{loading ? "Refreshing…" : "Refresh"}</Button></div>
      {liveError && <p role="alert" className="text-destructive text-sm">{liveError}</p>}
      {!live.length && loading && <p className="text-muted-foreground text-sm">Checking provider access…</p>}
      <div className="grid items-start gap-4 lg:grid-cols-2">{live.map((p) => <article key={p.provider} className="bg-card min-w-0 space-y-4 rounded-xl border p-5"><div className="flex justify-between gap-3"><h3 className="font-semibold">{p.provider}</h3><span className="text-muted-foreground text-xs">{p.status === "connected" ? "Connected" : p.status === "setup" ? "Setup required" : "Access unavailable"}</span></div><p className="text-muted-foreground text-xs leading-relaxed">{p.message}</p>{p.cost !== undefined && p.currency && <p className="text-xl font-semibold">{money(p.cost, p.currency)} <span className="text-muted-foreground text-xs font-normal">reported charges</span></p>}{p.period && <p className="text-muted-foreground text-xs">{p.period}</p>}<div className="max-h-96 space-y-5 overflow-y-auto">{p.metrics.map((m, i) => <div key={i}><Meter metric={m} unlimited={p.provider === "Resend" && m.limit === null} />{m.reset && <p className="text-muted-foreground mt-1 text-xs">Resets {new Date(m.reset).toLocaleString()}</p>}</div>)}</div>{p.asOf && <p className="text-muted-foreground text-xs">Fetched {new Date(p.asOf).toLocaleString()}</p>}</article>)}</div>
      <p className="text-muted-foreground flex items-start gap-2 text-xs"><Gauge className="size-4 shrink-0" />Supabase costs and quotas are entered from its dashboard. Database size alone does not measure billable storage, egress or monthly active users. API credentials stay on the server.</p>
    </section>
    {editing && <ProviderEditor key={editing.id} provider={editing} onClose={() => setEditing(null)} onSaved={(rows) => { setProviders(rows); setEditing(null); }} />}
  </div>;
}

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="bg-card rounded-xl border p-5"><p className="text-muted-foreground text-xs font-medium">{label}</p><p className="my-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p><p className="text-muted-foreground text-xs">{detail}</p></div>;
}

function ProviderEditor({ provider, onClose, onSaved }: { provider: SavedProvider; onClose: () => void; onSaved: (rows: SavedProvider[]) => void }) {
  const [draft, setDraft] = useState(provider);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const field = (key: "name" | "plan" | "scope" | "start" | "end" | "asOf" | "notes", label: string, type = "text") => <label className="grid min-w-0 gap-1.5 text-xs">{label}<input type={type} className={inputClass} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} /></label>;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const parsed = providerUsageSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ")); return; }
    if (draft.asOf > new Date().toISOString().slice(0, 10)) { setError("The observation date cannot be in the future."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/v1/admin/usage", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The provider record could not be saved.");
      onSaved(body.data);
    } catch (e) { setError(e instanceof Error ? e.message : "The provider record could not be saved."); }
    finally { setSaving(false); }
  }
  function metric(index: number, patch: Partial<UsageMetric>) { setDraft({ ...draft, metrics: draft.metrics.map((m, i) => i === index ? { ...m, ...patch } : m) }); }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{provider.name ? `Edit ${provider.name}` : "Add provider"}</DialogTitle><DialogDescription>Use your actual plan and billing period. Leave unknown amounts blank. Saving replaces this provider’s previous record.</DialogDescription></DialogHeader>
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">{field("name", "Provider name")}{field("plan", "Plan name")}{field("scope", "Scope — team, organization or project")}<label className="grid gap-1.5 text-xs">Currency<select className={inputClass} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value as SavedProvider["currency"] })}>{["USD", "CAD", "EUR", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></label></div>
      <div className="grid gap-3 sm:grid-cols-3">{field("start", "Period starts (UTC)", "date")}{field("end", "Period ends (exclusive, UTC)", "date")}{field("asOf", "Figures observed on (UTC)", "date")}</div>
      <div className="grid gap-3 sm:grid-cols-2">{([['reported', 'Total reported spend so far'], ['recurring', 'Recurring fee per period']] as const).map(([key, label]) => <label key={key} className="grid gap-1.5 text-xs">{label}<input className={inputClass} type="number" min="0" step="any" placeholder="Unknown" value={draft[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value === "" ? null : Number(e.target.value) })} /></label>)}</div>
      <div className="space-y-3"><h3 className="text-sm font-medium">Usage allowances</h3><p className="text-muted-foreground text-xs">Usage and limits must use the same unit and period. For daily limits, use a separate provider record with a daily period. For storage, enter the current measurement.</p>{draft.metrics.map((m, i) => <div key={i} className="space-y-3 rounded-lg border p-3"><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-xs">Metric<input className={inputClass} value={m.name} onChange={(e) => metric(i, { name: e.target.value })} /></label><label className="grid gap-1.5 text-xs">Unit<input className={inputClass} value={m.unit} onChange={(e) => metric(i, { unit: e.target.value })} /></label></div><div className="grid gap-3 sm:grid-cols-3">{([['used', 'Used'], ['limit', 'Included / limit']] as const).map(([key, label]) => <label key={key} className="grid gap-1.5 text-xs">{label}<input className={inputClass} type="number" min="0" step="any" placeholder="Unknown" value={m[key] ?? ""} onChange={(e) => metric(i, { [key]: e.target.value === "" ? null : Number(e.target.value) })} /></label>)}<label className="grid gap-1.5 text-xs">At the limit<select className={inputClass} value={m.behavior} onChange={(e) => metric(i, { behavior: e.target.value as UsageMetric["behavior"] })}><option value="overage">Overage billing</option><option value="hard">Hard cap</option><option value="budget">Reference threshold</option></select></label></div><Button type="button" variant="ghost" size="sm" onClick={() => setDraft({ ...draft, metrics: draft.metrics.filter((_, index) => index !== i) })}>Remove metric</Button></div>)}<Button type="button" variant="outline" size="sm" disabled={draft.metrics.length >= 30} onClick={() => setDraft({ ...draft, metrics: [...draft.metrics, { name: "", unit: "", used: null, limit: null, behavior: "overage" }] })}><Plus className="size-4" />Add metric</Button></div>
      {field("notes", "Notes / overage rates / source")}
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save provider"}</Button></div>
    </form>
  </DialogContent></Dialog>;
}


