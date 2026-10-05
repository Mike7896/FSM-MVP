"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  BellOff,
  DollarSign,
  Flag,
  Loader2,
  RefreshCw,
  Sparkles,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AdminMetrics } from "@/lib/admin/metrics";
import type { AdminEventLevel } from "@/lib/db/schema/admin";
import { cn } from "@/lib/utils";

import {
  ActivityPanels,
  FounderKpis,
  FounderPanels,
  BusinessesPanel,
  FunnelPanel,
  HealthPanels,
  KpiGrid,
  OnlinePanel,
  Panel,
  RevenuePanel,
  SupportPanel,
  TrendPanels,
} from "./admin-panels";
import {
  askDesktopPermission,
  desktopPermission,
  notifyDesktop,
  playSound,
  soundReady,
  unlockSound,
  useAlertPrefs,
  type AlertChannel,
} from "./alerts";
import { ago, money } from "./format";
import { useLive, type LiveEvent, type PresenceRow } from "./use-live";

/**
 * THE ADMIN DASHBOARD — ServiceClerk, live.
 *
 * Built to sit open on a second monitor, and live all the way through:
 *
 * - **The feed and the alerts** are the event log's rows, pushed by Supabase
 *   Realtime — a purchase in Ohio is a sound and a banner here within a second
 *   of the webhook landing.
 * - **Who's online right now** is counted here from presence rows Realtime
 *   pushes as they're touched.
 * - **Every other number** — the founder's revenue and usage numbers first —
 *   is re-read the moment the database says a table it counts from changed (a
 *   trigger signal, `useLive`), and whenever the connection comes back.
 *   Missed feed lines are caught up at the same moments.
 *
 * The one timer left is the clock: "today", "last 7 days" and the hourly pulse
 * move because time passes, not because anything is written, so nothing could
 * push them. The numbers are re-read on each five-minute mark for that.
 *
 * Visual polish was deliberately traded for more numbers — it's for the people
 * who build the product, not the people who use it.
 */

const LEVELS: { level: AdminEventLevel; label: string }[] = [
  { level: "money", label: "Money" },
  { level: "milestone", label: "Milestones" },
  { level: "problem", label: "Problems" },
  { level: "activity", label: "Activity" },
];

const LEVEL_LOOK: Record<AdminEventLevel, { dot: string; text: string; Icon: typeof DollarSign }> = {
  money: { dot: "bg-emerald-500", text: "text-emerald-500", Icon: DollarSign },
  milestone: { dot: "bg-sky-500", text: "text-sky-500", Icon: Flag },
  problem: { dot: "bg-destructive", text: "text-destructive", Icon: AlertTriangle },
  activity: { dot: "bg-muted-foreground", text: "text-muted-foreground", Icon: Zap },
};

const MINUTE = 60_000;

const TESTS: { level: AdminEventLevel; title: string; amount?: number }[] = [
  { level: "money", title: "Test: Reyes Electric bought Pro — $49.00/month", amount: 4900 },
  { level: "milestone", title: "Test: someone signed up" },
  { level: "problem", title: "Test: Problem reported #0: the board won't load" },
];

/**
 * Drawn in the browser only: nearly every line on it is "N minutes ago" or
 * the time now, which the server can't know.
 */
export function AdminDashboard(props: Parameters<typeof Dashboard>[0]) {
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );
  if (!mounted) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
        <Loader2 className="size-4 animate-spin" /> Opening the live dashboard…
      </p>
    );
  }
  return <Dashboard {...props} />;
}

function Dashboard({
  initialEvents,
  initialPresence,
  adminEmail,
}: {
  initialEvents: LiveEvent[];
  initialPresence: (PresenceRow & { business: string | null })[];
  adminEmail: string;
}) {
  const client = useQueryClient();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const metrics = useQuery({
    queryKey: ["admin-metrics", timeZone],
    queryFn: async (): Promise<AdminMetrics> => {
      const response = await fetch(`/api/v1/admin/metrics?${new URLSearchParams({ tz: timeZone })}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { data?: AdminMetrics; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "The numbers didn't load.");
      return body.data;
    },
    placeholderData: (previous) => previous,
  });

  const [events, setEvents] = useState<LiveEvent[]>(initialEvents);
  const [shownLevels, setShownLevels] = useState<Set<AdminEventLevel>>(() => new Set(LEVELS.map((entry) => entry.level)));
  const [showTest, setShowTest] = useState(false);
  const [showDemo, setShowDemo] = useState(true);
  // Shown by default: the team's own use, worth watching land, never counted.
  const [showInternal, setShowInternal] = useState(true);
  const [spotlight, setSpotlight] = useState<LiveEvent | null>(
    () => initialEvents.find((event) => event.level === "money" && !event.test && !event.internal) ?? null
  );
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [unseen, setUnseen] = useState(0);
  const [prefs, setPrefs] = useAlertPrefs();
  const [soundOn, setSoundOn] = useState(false);
  const permission = useDesktopPermission();
  const now = useNow(15_000);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every line already in the feed, so one that arrives twice — pushed, and
  // fetched by a catch-up — is shown and announced once.
  const seen = useRef(new Set(initialEvents.map((event) => event.id)));
  const lastId = useRef(initialEvents.reduce((max, event) => Math.max(max, event.id), 0));
  const catchUpRef = useRef<() => void>(() => undefined);

  /*
   * Re-read the numbers, and catch the feed up, soon. A burst of writes — a
   * checkout touches four tables — becomes one read. A signal that lands while
   * a read is running waits for it and reads again after, so a write committed
   * mid-read is never left out.
   */
  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) return;
    const run = () => {
      if (client.isFetching({ queryKey: ["admin-metrics"] })) {
        refreshTimer.current = setTimeout(run, 400);
        return;
      }
      refreshTimer.current = null;
      void client.refetchQueries({ queryKey: ["admin-metrics"] });
      catchUpRef.current();
    };
    refreshTimer.current = setTimeout(run, 600);
  }, [client]);

  // The clock: windows that move with time alone, on each five-minute mark.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const next = new Date();
      next.setMinutes(Math.floor(next.getMinutes() / 5) * 5 + 5, 0, 0);
      timer = setTimeout(() => {
        refreshSoon();
        schedule();
      }, next.getTime() - Date.now());
    };
    schedule();
    return () => clearTimeout(timer);
  }, [refreshSoon]);

  /* ── Something happened ───────────────────────────────────────────── */

  const onEvent = useCallback(
    (event: LiveEvent, options: { local?: boolean; quiet?: boolean } = {}) => {
      if (!options.local) {
        if (seen.current.has(event.id)) return;
        seen.current.add(event.id);
        lastId.current = Math.max(lastId.current, event.id);
      }
      // Newest first by when it happened — a caught-up line takes its place
      // in time, not the top of the list.
      setEvents((current) =>
        [event, ...current.filter((existing) => existing.id !== event.id)]
          .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id - a.id)
          .slice(0, 500)
      );
      setFresh((current) => new Set(current).add(event.id));
      setTimeout(() => setFresh((current) => {
        const next = new Set(current);
        next.delete(event.id);
        return next;
      }), 4000);

      // In the feed, but no sound, banner or spotlight: not real business.
      if ((event.test || event.internal) && !options.local) {
        if (!event.test) refreshSoon();
        return;
      }
      if (options.quiet) {
        if (event.level === "money" || event.level === "milestone") setSpotlight(event);
        return;
      }

      const channel = prefs[event.level];
      const heading = event.level === "money" ? `💰 ${money(event.amount_cents)}` : LEVELS.find((entry) => entry.level === event.level)!.label.replace(/s$/, "");
      if (channel.toast) {
        const show = event.level === "money" ? toast.success : event.level === "problem" ? toast.error : toast;
        show(event.title, { description: event.org_name ?? undefined, duration: event.level === "money" ? 15_000 : 6000 });
      }
      if (channel.sound) playSound(event.level, channel.volume);
      if (channel.desktop) notifyDesktop(heading, event.title, `admin-${event.id}`);
      if (event.level === "money" || event.level === "milestone") setSpotlight(event);
      if (document.visibilityState !== "visible") setUnseen((count) => count + 1);

      // The counts by kind, the pulse and "most active" are read from the log.
      if (!options.local) refreshSoon();
    },
    [prefs, refreshSoon]
  );

  /*
   * Catch the feed up: everything after the last line it has. A push can be
   * missed — the connection blinks, the laptop sleeps, a line lands while the
   * page is still loading — and this is what makes "missed" mean "late".
   * A few missed lines alert as usual; a pile becomes one summary.
   */
  const catching = useRef<"idle" | "busy" | "again">("idle");
  useEffect(() => {
    catchUpRef.current = () => {
      if (catching.current !== "idle") {
        catching.current = "again";
        return;
      }
      catching.current = "busy";
      void (async () => {
        try {
          const response = await fetch(`/api/v1/admin/events?after=${lastId.current}`, { cache: "no-store" });
          const body = (await response.json().catch(() => null)) as { data?: { events: LiveEvent[]; more: boolean } } | null;
          if (!response.ok || !body?.data) return;
          const missed = body.data.events.filter((event) => !seen.current.has(event.id));
          const quiet = missed.length > 3;
          for (const event of missed) onEvent(event, { quiet });
          const counted = missed.filter((event) => !event.test && !event.internal).length;
          if (quiet && counted) {
            toast(`Caught up on ${counted} event${counted === 1 ? "" : "s"} the live feed missed`, {
              description: body.data.more ? "Older ones are in the Event log." : undefined,
              duration: 10_000,
            });
          }
        } finally {
          const rerun = catching.current === "again";
          catching.current = "idle";
          if (rerun) catchUpRef.current();
        }
      })();
    };
  }, [onEvent]);

  const { status, presence } = useLive({
    onEvent,
    onChanged: refreshSoon,
    onSynced: refreshSoon,
    initialPresence,
  });

  // Presence rows carry an organization id; names come from the first read
  // and from the newest-businesses list.
  const businessNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const row of initialPresence) if (row.organization_id && row.business) names[row.organization_id] = row.business;
    for (const row of metrics.data?.newest ?? []) names[String(row.id)] = String(row.name);
    return names;
  }, [initialPresence, metrics.data]);
  // Check scripts and testers aren't users; Realtime delivers them anyway.
  const testUsers = useMemo(() => new Set(metrics.data?.testUserIds ?? []), [metrics.data]);
  const people = Object.values(presence).filter((row) => !testUsers.has(row.user_id));
  // A presence row is touched each minute the app is open, so two minutes
  // without one means gone. Daily, weekly and monthly active users are the
  // server's, from the hour-by-hour history.
  const onlineNow = people.filter((row) => now - Date.parse(row.last_seen) < 2 * MINUTE).length;
  const online = people
    .filter((row) => now - Date.parse(row.last_seen) < 15 * MINUTE)
    .map((row) => ({ ...row, business: row.organization_id ? (businessNames[row.organization_id] ?? null) : null }))
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen));
  const lastSeenByBusiness: Record<string, string> = {};
  for (const row of people) {
    const id = row.organization_id;
    if (id && (!lastSeenByBusiness[id] || row.last_seen > lastSeenByBusiness[id])) lastSeenByBusiness[id] = row.last_seen;
  }

  /* ── The tab says how much you missed ─────────────────────────────── */

  useEffect(() => {
    const base = "Live · ServiceClerk admin";
    document.title = unseen ? `(${unseen}) ${base}` : base;
    const seen = () => {
      if (document.visibilityState === "visible") setUnseen(0);
    };
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, [unseen]);

  const feed = events.filter(
    (event) =>
      shownLevels.has(event.level) &&
      (showTest || !event.test) &&
      (showInternal || !event.internal) &&
      (showDemo || !event.demo)
  );

  return (
    <div className="flex min-h-svh flex-col gap-2 p-2 md:p-3">
      {/* Header. */}
      <header className="bg-card flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
        <span className="font-semibold tracking-tight">ServiceClerk · Live</span>
        <StatusPill status={status} />
        <span className="text-muted-foreground text-xs tabular-nums">
          {new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · {timeZone}
        </span>
        <span className="text-muted-foreground hidden text-xs sm:inline">· {adminEmail}</span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={soundOn ? "secondary" : "outline"}
            onClick={() => {
              if (soundOn) setSoundOn(false);
              else {
                unlockSound();
                setSoundOn(true);
                setTimeout(() => soundReady() && playSound("milestone", prefs.milestone.volume), 50);
              }
            }}
          >
            {soundOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            {soundOn ? "Sound on" : "Turn sound on"}
          </Button>
          <Button
            size="sm"
            variant={permission === "granted" ? "secondary" : "outline"}
            disabled={permission === "granted" || permission === "denied" || permission === "unsupported"}
            onClick={() => void askDesktopPermission()}
            title={permission === "denied" ? "Blocked in this browser's site settings" : undefined}
          >
            {permission === "granted" ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            {permission === "granted" ? "Desktop alerts on" : permission === "denied" ? "Desktop alerts blocked" : "Desktop alerts"}
          </Button>
          <AlertSettings prefs={prefs} onChange={setPrefs} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <Sparkles className="size-4" />
                Test alert
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                Plays here only — nothing is saved
              </DropdownMenuLabel>
              {TESTS.map((test) => (
                <DropdownMenuItem
                  key={test.level}
                  onSelect={() =>
                    onEvent(
                      {
                        id: -Date.now(),
                        occurred_at: new Date().toISOString(),
                        kind: "test.local",
                        level: test.level,
                        organization_id: null,
                        org_name: "Test alert",
                        user_id: null,
                        title: test.title,
                        amount_cents: test.amount ?? null,
                        test: true,
                        internal: false,
                        demo: false,
                        data: {},
                      },
                      { local: true }
                    )
                  }
                >
                  <span className={cn("size-2 rounded-full", LEVEL_LOOK[test.level].dot)} />
                  {LEVELS.find((entry) => entry.level === test.level)!.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void metrics.refetch()}
            title={metrics.dataUpdatedAt ? `Numbers read ${ago(new Date(metrics.dataUpdatedAt).toISOString(), now)}` : undefined}
          >
            {metrics.isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            <span className="text-muted-foreground text-xs">
              {metrics.dataUpdatedAt ? ago(new Date(metrics.dataUpdatedAt).toISOString(), now) : "loading"}
            </span>
          </Button>
        </div>
      </header>

      {/* The last big thing. */}
      {spotlight ? <Spotlight event={spotlight} now={now} /> : null}

      {metrics.data ? (
        <>
          <FounderKpis metrics={metrics.data} />
          <KpiGrid metrics={metrics.data} online={onlineNow} />
        </>
      ) : metrics.isError ? (
        <p className="text-destructive rounded-lg border p-3 text-sm">{metrics.error.message}</p>
      ) : (
        <p className="text-muted-foreground flex items-center gap-2 rounded-lg border p-3 text-sm">
          <Loader2 className="size-4 animate-spin" /> Reading every number…
        </p>
      )}

      <div className="grid min-h-0 gap-2 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-2">
          {metrics.data ? <FounderPanels metrics={metrics.data} /> : null}
          {metrics.data ? <TrendPanels metrics={metrics.data} /> : null}
          <div className="grid gap-2 lg:grid-cols-2">
            {metrics.data ? <FunnelPanel metrics={metrics.data} /> : null}
            <OnlinePanel rows={online} now={now} />
            {metrics.data ? <RevenuePanel metrics={metrics.data} /> : null}
            {metrics.data ? <ActivityPanels metrics={metrics.data} now={now} /> : null}
          </div>
        </div>

        {/* The feed. */}
        <Panel
          title="Live feed"
          aside={`${feed.length} shown`}
          className="min-h-0 overflow-hidden xl:sticky xl:top-3 xl:max-h-[calc(100svh-1.5rem)] xl:self-start"
          contentClassName="flex min-h-0 flex-col overflow-hidden"
        >
          <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1">
            {LEVELS.map((entry) => {
              const on = shownLevels.has(entry.level);
              return (
                <button
                  key={entry.level}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setShownLevels((current) => {
                      const next = new Set(current);
                      if (next.has(entry.level)) next.delete(entry.level);
                      else next.add(entry.level);
                      return next;
                    })
                  }
                  className={cn(
                    "flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px]",
                    on ? "bg-muted" : "text-muted-foreground opacity-60"
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", LEVEL_LOOK[entry.level].dot)} />
                  {entry.label}
                </button>
              );
            })}
            <label className="text-muted-foreground ml-1 flex items-center gap-1.5 text-[11px]">
              <Checkbox checked={showDemo} onCheckedChange={(checked) => setShowDemo(checked === true)} className="size-3.5" />
              Demo
            </label>
            <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
              <Checkbox checked={showInternal} onCheckedChange={(checked) => setShowInternal(checked === true)} className="size-3.5" />
              Internal
            </label>
            <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
              <Checkbox checked={showTest} onCheckedChange={(checked) => setShowTest(checked === true)} className="size-3.5" />
              Test shops
            </label>
          </div>
          <ol className="flex min-h-0 max-h-[70svh] flex-col overflow-y-auto overscroll-contain xl:max-h-none xl:flex-1">
            {feed.length === 0 ? (
              <li className="text-muted-foreground py-6 text-center text-xs">
                Nothing yet. It appears here the moment it happens.
              </li>
            ) : (
              feed.map((event) => <FeedRow key={event.id} event={event} now={now} fresh={fresh.has(event.id)} />)
            )}
          </ol>
        </Panel>
      </div>

      {metrics.data ? (
        <>
          <BusinessesPanel metrics={metrics.data} lastSeen={lastSeenByBusiness} now={now} />
          <div className="grid gap-2 lg:grid-cols-2">
            <SupportPanel rows={metrics.data.support} onChanged={() => void metrics.refetch()} />
            <div className="grid gap-2">
              <HealthPanels metrics={metrics.data} now={now} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────── */

function StatusPill({ status }: { status: string }) {
  const look =
    status === "live"
      ? { dot: "bg-emerald-500 animate-pulse", text: "Live" }
      : status === "connecting"
        ? { dot: "bg-amber-500", text: "Connecting" }
        : status === "reconnecting"
          ? { dot: "bg-amber-500 animate-pulse", text: "Reconnecting" }
          : { dot: "bg-destructive", text: "Offline" };
  return (
    <span className="bg-muted flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs">
      <span className={cn("size-2 rounded-full", look.dot)} />
      {look.text}
    </span>
  );
}

function Spotlight({ event, now }: { event: LiveEvent; now: number }) {
  const money_ = event.level === "money";
  return (
    <div
      key={event.id}
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-3 animate-in fade-in slide-in-from-top-2",
        money_ ? "border-emerald-500/40 bg-emerald-500/10" : "border-sky-500/40 bg-sky-500/10"
      )}
    >
      {money_ ? <DollarSign className="size-7 text-emerald-500" /> : <Flag className="size-6 text-sky-500" />}
      <div className="min-w-0 flex-1">
        <p className={cn("text-lg font-semibold tracking-tight", money_ ? "text-emerald-500" : "text-sky-500")}>
          {event.title}
        </p>
        <p className="text-muted-foreground text-xs">
          {money_ ? "Latest money" : "Latest milestone"} · {ago(event.occurred_at, now)}
          {event.test ? " · test" : ""}
          {event.demo ? " · demo" : ""}
        </p>
      </div>
      {event.amount_cents ? (
        <span className="text-3xl font-semibold text-emerald-500 tabular-nums">{money(event.amount_cents)}</span>
      ) : null}
    </div>
  );
}

function FeedRow({ event, now, fresh }: { event: LiveEvent; now: number; fresh: boolean }) {
  const look = LEVEL_LOOK[event.level];
  return (
    <li
      className={cn(
        "flex shrink-0 gap-2 border-b py-1.5 text-xs transition-colors duration-1000",
        fresh && (event.level === "money" ? "bg-emerald-500/15" : "bg-primary/10"),
        (event.test || event.internal || event.demo) && "opacity-60"
      )}
    >
      <look.Icon className={cn("mt-0.5 size-3.5 shrink-0", look.text)} />
      <div className="min-w-0 flex-1">
        <p className="leading-snug [overflow-wrap:anywhere]">
          {event.title}
          {event.demo ? <span className="text-muted-foreground"> · demo</span> : null}
          {event.internal ? <span className="text-muted-foreground"> · internal</span> : null}
          {event.test ? <span className="text-muted-foreground"> · test</span> : null}
        </p>
        <p className="text-muted-foreground text-[10px] [overflow-wrap:anywhere]">
          {event.kind}
          {event.org_name ? ` · ${event.org_name}` : ""}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {event.amount_cents ? <p className={cn("font-medium tabular-nums", look.text)}>{money(event.amount_cents)}</p> : null}
        <p className="text-muted-foreground text-[10px] tabular-nums" title={new Date(event.occurred_at).toLocaleString()}>
          {ago(event.occurred_at, now)}
        </p>
      </div>
    </li>
  );
}

function AlertSettings({
  prefs,
  onChange,
}: {
  prefs: ReturnType<typeof useAlertPrefs>[0];
  onChange: ReturnType<typeof useAlertPrefs>[1];
}) {
  const channels: { channel: AlertChannel; label: string }[] = [
    { channel: "toast", label: "Pop-up" },
    { channel: "sound", label: "Sound" },
    { channel: "desktop", label: "Desktop" },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          Alert me for…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[80svh] w-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th className="pb-2 text-left font-normal" />
              {channels.map((entry) => (
                <th key={entry.channel} className="pb-2 font-normal">
                  {entry.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEVELS.map((entry) => (
              <tr key={entry.level}>
                <td className="py-1.5">
                  <span className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", LEVEL_LOOK[entry.level].dot)} />
                    {entry.label}
                  </span>
                </td>
                {channels.map((channel) => (
                  <td key={channel.channel} className="text-center">
                    <Checkbox
                      aria-label={`${entry.label} ${channel.label}`}
                      checked={prefs[entry.level][channel.channel]}
                      onCheckedChange={(checked) =>
                        onChange({
                          ...prefs,
                          [entry.level]: { ...prefs[entry.level], [channel.channel]: checked === true },
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 space-y-3 border-t pt-4">
          <p className="text-sm font-medium">Volume mixer</p>
          {LEVELS.map(entry => <div key={entry.level} className="space-y-1">
            <label htmlFor={`volume-${entry.level}`} className="flex justify-between text-xs"><span>{entry.label}</span><span>{Math.round(prefs[entry.level].volume * 100)}%</span></label>
            <div className="flex items-center gap-3"><input id={`volume-${entry.level}`} type="range" min="0" max="100" step="1" className="min-w-0 flex-1 accent-primary" value={Math.round(prefs[entry.level].volume * 100)} onChange={event => onChange({ ...prefs, [entry.level]: { ...prefs[entry.level], volume: Number(event.target.value) / 100 } })} />
            <Button size="sm" variant="ghost" aria-label={`Preview ${entry.label} sound`} onClick={() => { unlockSound(); setTimeout(() => playSound(entry.level, prefs[entry.level].volume), 50); }}>Test</Button></div>
          </div>)}
          <p className="text-muted-foreground text-xs">Saved in this browser. Set a volume to 0% to mute it.</p>
        </div>
        <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
          Money is purchases and payments. Milestones are signups, new businesses, trials, first quotes and
          wins. Problems are failed payments, cancellations, bug reports and failed deliveries. Activity is
          everything else. Internal accounts never alert — they&apos;re in the feed, not the business.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** A clock that ticks, for "3m ago" that stays true. */
function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

/** The browser's answer on desktop notifications, kept current. */
function useDesktopPermission() {
  return useSyncExternalStore(
    (onChange) => {
      const timer = setInterval(onChange, 1000);
      return () => clearInterval(timer);
    },
    () => desktopPermission(),
    () => "default" as const
  );
}
