"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, CircleDashed, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { AdminMetrics, Row } from "@/lib/admin/metrics";
import { cn } from "@/lib/utils";

import { SupportReply } from "./support-reply";
import { Bars, FunnelRow } from "./charts";
import { ago, money, n, num, pct, text, when } from "./format";

/**
 * The dashboard's panels — every number the metrics read returns, laid out
 * densely. Presentation only: the live shell owns the data and the clock.
 */

export function Panel({
  title,
  aside,
  children,
  className,
  contentClassName,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn("bg-card flex min-w-0 flex-col rounded-lg border", className)}>
      <header className="flex shrink-0 items-baseline justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-muted-foreground font-label text-[10px] tracking-wide uppercase">{title}</h2>
        {aside ? <span className="text-muted-foreground text-[11px]">{aside}</span> : null}
      </header>
      <div className={cn("min-w-0 flex-1 p-3", contentClassName)}>{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "money" | "good" | "bad";
}) {
  return (
    <div className="bg-card min-w-0 rounded-lg border px-3 py-2.5">
      <p className="text-muted-foreground truncate text-[11px]">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate text-2xl font-semibold tracking-tight tabular-nums",
          tone === "money" && "text-emerald-500",
          tone === "good" && "text-sky-500",
          tone === "bad" && "text-destructive"
        )}
      >
        {value}
      </p>
      {sub ? <p className="text-muted-foreground mt-0.5 truncate text-[11px] tabular-nums">{sub}</p> : null}
    </div>
  );
}

export function KpiGrid({ metrics, online }: { metrics: AdminMetrics; online: number }) {
  const { people, revenue, usage, money: cash } = metrics;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Online now" value={online} sub={`${num(people.active_24h)} in 24h · ${num(people.active_7d)} in 7d`} tone="good" />
      <Stat label="Events · last hour" value={num(people.events_hour)} sub={`${num(people.events_today)} today`} />
      <Stat label="Signups today" value={num(people.signups_today)} sub={`${num(people.signups_7d)} 7d · ${num(people.signups_30d)} 30d · ${num(people.users)} all`} />
      <Stat label="New businesses today" value={num(people.businesses_today)} sub={`${num(people.businesses_7d)} 7d · ${num(people.businesses)} all`} />
      <Stat
        label="Active today"
        value={num(people.active_today)}
        sub={people.signins_logged ? `people · ${num(people.signed_in_today)} fresh sign-ins` : "people · sign-ins aren't being logged"}
      />
      <Stat label="Support open" value={num(people.support_open)} sub={`${metrics.support.length} recent shown`} tone={n(people, "support_open") ? "bad" : undefined} />

      <Stat
        label="MRR"
        value={money(revenue.mrrCents)}
        sub={revenue.estimated ? `${revenue.paying} paying · ${revenue.estimated} at list price` : `${revenue.paying} paying`}
        tone="money"
      />
      <Stat label="Trials" value={revenue.trialing} sub={`${revenue.trialsEnding.length} ending in 7 days`} />
      <Stat label="Past due" value={revenue.pastDue} sub={`${revenue.canceled} canceled all-time`} tone={revenue.pastDue ? "bad" : undefined} />
      <Stat label="Collected today" value={money(cash.today)} sub={`${money(cash.week)} 7d · ${money(cash.month)} 30d`} tone="money" />
      <Stat label="Collected all-time" value={money(cash.all_time)} sub={`${num(cash.count_30d)} payments 30d · ${pct(cash.card_30d, cash.month)} card`} tone="money" />
      <Stat label="Card payments on" value={num(cash.card_enabled)} sub="businesses" />

      <Stat label="Quotes sent today" value={num(usage.sent_today)} sub={`${num(usage.sent_7d)} 7d · ${num(usage.sent_30d)} 30d · ${num(usage.sent_all)} all`} />
      <Stat label="Quotes won today" value={num(usage.accepted_today)} sub={`${num(usage.accepted_7d)} 7d · ${num(usage.accepted_30d)} 30d`} tone="good" />
      <Stat label="Win rate · 30d" value={pct(usage.accepted_30d, usage.sent_30d)} sub={`${pct(usage.opened_all, usage.sent_all)} of sent get opened`} />
      <Stat label="Quotes started today" value={num(usage.quotes_today)} sub={`${num(usage.quotes_7d)} 7d · ${num(usage.quotes_30d)} 30d`} />
      <Stat label="Demo quotes · 7d" value={num(usage.demo_quotes_7d)} sub="people trying it out" />
      <Stat
        label="Everyday use · 7d"
        value={num(n(usage, "jobs_7d") + n(usage, "visits_7d") + n(usage, "tasks_7d"))}
        sub={`${num(usage.jobs_7d)} jobs · ${num(usage.visits_7d)} visits · ${num(usage.tasks_7d)} tasks`}
      />
    </div>
  );
}

export function TrendPanels({ metrics }: { metrics: AdminMetrics }) {
  const days = metrics.series.map((row) => text(row, "day").slice(5));
  const series = (key: string) => metrics.series.map((row) => n(row, key));
  const hours = metrics.hourly.map((row) =>
    new Date(text(row, "hour")).toLocaleTimeString("en-US", { hour: "numeric" })
  );
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      <Panel title="Signups · 30 days">
        <Bars values={series("signups")} labels={days} tone="bg-sky-500" />
      </Panel>
      <Panel title="New businesses · 30 days">
        <Bars values={series("businesses")} labels={days} tone="bg-violet-500" />
      </Panel>
      <Panel title="Quotes sent · 30 days">
        <Bars values={series("sent")} labels={days} />
      </Panel>
      <Panel title="Money collected · 30 days">
        <Bars values={series("collected")} labels={days} tone="bg-emerald-500" format={money} />
      </Panel>
      <Panel title="Everything logged · 30 days">
        <Bars values={series("events")} labels={days} tone="bg-muted-foreground" />
      </Panel>
      <Panel title="Pulse · last 24 hours" aside="all events · big ones">
        <Bars values={metrics.hourly.map((row) => n(row, "events"))} labels={hours} tone="bg-muted-foreground" />
        <Bars
          className="mt-2"
          values={metrics.hourly.map((row) => n(row, "big"))}
          labels={hours}
          tone="bg-amber-500"
        />
      </Panel>
    </div>
  );
}

export function FunnelPanel({ metrics }: { metrics: AdminMetrics }) {
  const f = metrics.funnel;
  const steps: [string, number][] = [
    ["People signed up", n(f, "signed_up")],
    ["Set up a business", n(f, "business")],
    ["Started a quote", n(f, "quoted")],
    ["Sent a quote", n(f, "sent")],
    ["Won a job", n(f, "won")],
    ["Card payments on", n(f, "card")],
    ["Trial or plan", n(f, "subscribed")],
    ["Paying", n(f, "paying")],
  ];
  return (
    <Panel title="Funnel · last 90 days" aside="people who signed up, then businesses reaching each step · % of the step before">
      <div className="flex flex-col gap-1.5">
        {steps.map(([label, value], index) => (
          <FunnelRow key={label} label={label} value={value} first={steps[0][1] || steps[1][1]} previous={index ? steps[index - 1][1] : null} />
        ))}
      </div>
    </Panel>
  );
}

export function RevenuePanel({ metrics }: { metrics: AdminMetrics }) {
  const { revenue } = metrics;
  return (
    <Panel title="Subscriptions" aside={`MRR ${money(revenue.mrrCents)} · after discounts, packs included`}>
      {revenue.byPlan.length ? (
        <Table
          head={["Plan", "Status", "Count", "MRR"]}
          rows={revenue.byPlan.map((row) => [row.plan, row.status, num(row.count), row.status === "active" ? money(row.mrrCents) : "—"])}
        />
      ) : (
        <Empty>No subscriptions yet.</Empty>
      )}
      <p className="text-muted-foreground mt-3 mb-1 text-[11px]">Trials ending in the next 7 days</p>
      {revenue.trialsEnding.length ? (
        <Table head={["Business", "Ends"]} rows={revenue.trialsEnding.map((row) => [text(row, "name"), when(row.trial_end)])} />
      ) : (
        <Empty>None.</Empty>
      )}
    </Panel>
  );
}

export function OnlinePanel({
  rows,
  now,
}: {
  rows: { area: string; device: string | null; last_seen: string; business: string | null }[];
  now: number;
}) {
  const live = rows.filter((row) => now - new Date(row.last_seen).getTime() < 120_000);
  const byArea = Object.entries(
    live.reduce<Record<string, number>>((all, row) => ({ ...all, [row.area]: (all[row.area] ?? 0) + 1 }), {})
  ).sort((a, b) => b[1] - a[1]);
  return (
    <Panel title="Who's in the app" aside={`${live.length} now · area only, never the page`}>
      {byArea.length ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {byArea.map(([area, count]) => (
            <span key={area} className="bg-muted rounded px-2 py-0.5 text-xs tabular-nums">
              {area} · {count}
            </span>
          ))}
        </div>
      ) : null}
      {rows.length ? (
        <Table
          head={["Business", "Area", "Device", "Seen"]}
          rows={rows.map((row) => [row.business ?? "—", row.area, row.device ?? "—", ago(row.last_seen, now)])}
        />
      ) : (
        <Empty>Nobody in the last 15 minutes.</Empty>
      )}
    </Panel>
  );
}

export function BusinessesPanel({ metrics, now }: { metrics: AdminMetrics; now: number }) {
  return (
    <Panel title="Newest businesses" aside={`${metrics.newest.length} shown`}>
      {metrics.newest.length ? (
        <Table
          head={["Business", "Trade", "Owner", "Joined", "People", "Sent", "Won", "Collected", "Plan", "Last seen", "Last event"]}
          rows={metrics.newest.map((row) => [
            text(row, "name"),
            text(row, "trade") || "—",
            text(row, "owner") || "—",
            when(row.created_at),
            num(row.people),
            num(row.quotes_sent),
            num(row.won),
            money(row.collected),
            text(row, "plan") || "free",
            ago(row.last_seen, now),
            ago(row.last_event, now),
          ])}
        />
      ) : (
        <Empty>No businesses yet.</Empty>
      )}
    </Panel>
  );
}

export function ActivityPanels({ metrics, now }: { metrics: AdminMetrics; now: number }) {
  return (
    <>
      <Panel title="Most active · 7 days">
        {metrics.active.length ? (
          <Table
            head={["Business", "Events", "Big", "Last"]}
            rows={metrics.active.map((row) => [text(row, "name"), num(row.events), num(row.big), ago(row.last, now)])}
          />
        ) : (
          <Empty>Nothing logged this week.</Empty>
        )}
      </Panel>
      <Panel title="What happened · 24 hours">
        {metrics.byKind.length ? (
          <Table head={["Event", "Kind", "Count"]} rows={metrics.byKind.map((row) => [text(row, "kind"), text(row, "level"), num(row.count)])} />
        ) : (
          <Empty>Quiet day.</Empty>
        )}
      </Panel>
    </>
  );
}

export function SupportPanel({ rows, onChanged }: { rows: Row[]; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function mark(id: string, status: "open" | "answered" | "closed") {
    setBusy(id);
    const response = await fetch(`/api/v1/admin/support/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    setBusy(null);
    if (!response?.ok) toast.error("That didn't save.");
    else onChanged();
  }

  return (
    <Panel title="Support inbox" aside="problems, ideas and help requests — newest open first">
      {rows.length ? (
        <ul className="divide-y text-xs">
          {rows.map((row) => {
            const id = text(row, "id");
            const status = text(row, "status");
            const expanded = open === id;
            return (
              <li key={id} className="py-2">
                <button type="button" className="flex w-full items-baseline gap-2 text-left" onClick={() => setOpen(expanded ? null : id)}>
                  <span
                    className={cn(
                      "w-14 shrink-0 font-medium",
                      text(row, "kind") === "bug" ? "text-destructive" : text(row, "kind") === "idea" ? "text-sky-500" : "text-amber-500"
                    )}
                  >
                    {text(row, "kind") === "bug" ? "Problem" : text(row, "kind") === "idea" ? "Idea" : "Help"}
                  </span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">#{text(row, "number")}</span>
                  <span className={cn("min-w-0 flex-1 truncate", status !== "open" && "text-muted-foreground")}>{text(row, "subject")}</span>
                  <span className="text-muted-foreground shrink-0">{text(row, "business") || text(row, "reply_to")}</span>
                  <span className="text-muted-foreground w-24 shrink-0 text-right">{when(row.created_at)}</span>
                  <span className="w-16 shrink-0 text-right">
                    {status === "open" ? <CircleDashed className="ml-auto size-3.5 text-amber-500" /> : status === "answered" ? <CheckCircle2 className="ml-auto size-3.5 text-emerald-500" /> : <XCircle className="text-muted-foreground ml-auto size-3.5" />}
                  </span>
                </button>
                {expanded ? (
                  <div className="bg-muted/40 mt-2 flex flex-col gap-2 rounded-md p-3">
                    <p className="whitespace-pre-wrap">{text(row, "body")}</p>
                    <p className="text-muted-foreground">
                      From {text(row, "name") || text(row, "reply_to")} · {text(row, "reply_to")}
                      {text(row, "page") ? ` · on ${text(row, "page")}` : ""}
                      {row.emailed_at ? " · emailed to the inbox" : " · not emailed"}
                      {row.sentry_event_id ? ` · Sentry ${text(row, "sentry_event_id").slice(0, 8)}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {status !== "answered" ? (
                        <Button size="sm" variant="outline" disabled={busy === id} onClick={() => mark(id, "answered")}>
                          <CheckCircle2 className="size-3.5" /> Mark answered
                        </Button>
                      ) : null}
                      {status !== "closed" ? (
                        <Button size="sm" variant="ghost" disabled={busy === id} onClick={() => mark(id, "closed")}>
                          <XCircle className="size-3.5" /> Close
                        </Button>
                      ) : null}
                      {status !== "open" ? (
                        <Button size="sm" variant="ghost" disabled={busy === id} onClick={() => mark(id, "open")}>
                          <RotateCcw className="size-3.5" /> Reopen
                        </Button>
                      ) : null}
                    </div>
                    <SupportReply requestId={id} recipient={text(row, "reply_to")} onSent={onChanged} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>Nobody has asked for anything yet.</Empty>
      )}
    </Panel>
  );
}

export function HealthPanels({ metrics, now }: { metrics: AdminMetrics; now: number }) {
  const channels = ["email", "sms", "push"];
  const count = (channel: string, status: string) =>
    metrics.deliveries.filter((row) => row.channel === channel && row.status === status).reduce((sum, row) => sum + n(row, "count"), 0);
  const system = metrics.system;
  return (
    <>
      <Panel title="Notification delivery · 24 hours">
        <Table
          head={["Channel", "Sent", "Failed", "Pending", "Skipped"]}
          rows={channels.map((channel) => [channel, num(count(channel, "sent")), num(count(channel, "failed")), num(count(channel, "pending")), num(count(channel, "skipped"))])}
        />
        <p className="text-muted-foreground mt-3 mb-1 text-[11px]">Latest failures</p>
        {metrics.failures.length ? (
          <Table
            head={["When", "Channel", "To", "Why"]}
            rows={metrics.failures.map((row) => [ago(row.updated_at, now), text(row, "channel"), text(row, "recipient"), text(row, "last_error")])}
          />
        ) : (
          <Empty>None.</Empty>
        )}
      </Panel>
      <Panel title="Stripe webhooks · latest">
        {metrics.stripe.length ? (
          <Table head={["Event", "Handled"]} rows={metrics.stripe.map((row) => [text(row, "type"), ago(row.processed_at, now)])} />
        ) : (
          <Empty>No webhooks received on this database.</Empty>
        )}
      </Panel>
      <Panel title="System">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Fact label="Database size" value={text(system.db, "size")} />
          <Fact label="Migrations applied" value={num(system.db.migrations)} />
          <Fact label="Events logged" value={num(system.db.events_logged)} />
          <Fact label="Log since" value={when(metrics.people.log_since)} />
          <Fact label="Admins" value={num(system.db.admins)} />
          <Fact label="Realtime tables" value={text(system.db, "realtime") || "none"} />
          <Fact label="Node" value={system.node} />
          <Fact label="Environment" value={system.environment} />
          <Fact label="Database clock" value={when(system.db.db_time)} />
          <Fact label="Day cut on" value={metrics.timeZone} />
        </div>
        <p className="text-muted-foreground mt-3 mb-1 text-[11px]">Switched on here</p>
        <div className="flex flex-wrap gap-1.5">
          {system.config.map((item) => (
            <span
              key={item.name}
              className={cn(
                "rounded px-2 py-0.5 text-[11px]",
                item.on ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground line-through"
              )}
            >
              {item.name}
            </span>
          ))}
        </div>
      </Panel>
      <Panel title="Biggest tables">
        <Table head={["Table", "Rows"]} rows={system.tables.map((row) => [text(row, "name"), num(row.rows)])} />
      </Panel>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right tabular-nums">{value}</span>
    </>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground text-left">
            {head.map((cell) => (
              <th key={cell} className="pb-1 pr-3 font-normal whitespace-nowrap">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((row, index) => (
            <tr key={index} className="border-t">
              {row.map((cell, column) => (
                <td key={column} className="max-w-64 truncate py-1 pr-3 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-xs">{children}</p>;
}
