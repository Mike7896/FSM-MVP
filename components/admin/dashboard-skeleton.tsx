import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { Panel } from "./admin-panels";

/**
 * The live dashboard before its numbers arrive — the same tiles and panels,
 * at the same sizes, with the real labels and titles and only the values
 * waiting. So nothing moves when they land.
 *
 * Built from slot-sized pieces, each matching one part of `Dashboard`: the
 * whole page uses them while the server reads (`app/admin/(live)/loading.tsx`)
 * and before the browser takes over, and `Dashboard` uses the same pieces in
 * each slot while the numbers are read. Tile labels mirror `FounderKpis` and
 * `KpiGrid`; panel titles mirror theirs.
 *
 * Tables size to a typical day, not a guess at today's — below the first
 * screen a panel growing by a row moves nothing anyone is looking at.
 */

function Bone({ className }: { className?: string }) {
  return <Skeleton className={cn("motion-reduce:animate-none", className)} />;
}

/**
 * A skeleton sitting on a line of text, so the line keeps its real height.
 * Its line is a `div`, never a `p`: the skeleton is a `div` itself, and a
 * `div` inside a `p` is invalid HTML that breaks hydration.
 */
function InlineBone({ className }: { className?: string }) {
  return <Bone className={cn("inline-block align-middle", className)} />;
}

/* ── Tiles ──────────────────────────────────────────────────────────── */

const FOUNDER_LABELS = [
  "MRR",
  "Net new MRR · 30d",
  "ARPA",
  "Revenue churn",
  "Lifetime value",
  "Revenue at risk",
  "We collected · 30d",
  "Refunds · 30d",
  "Platform fees · 30d",
  "Running costs",
  "Activation",
  "DAU · WAU · MAU",
];

const KPI_LABELS = [
  "Online now",
  "Events · last hour",
  "Signups today",
  "New businesses today",
  "Signed in today",
  "Support open",
  "Paying shops",
  "Trials ending",
  "Past due",
  "Contractors collected today",
  "Contractors collected, all time",
  "Card payments on",
  "Quotes sent today",
  "Quotes won today",
  "Win rate · 30d",
  "Quotes started today",
  "Demo quotes · 7d",
  "Everyday use · 7d",
];

function StatSkeletons({ labels }: { labels: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {labels.map((label, index) => (
        <div key={label} className="bg-card min-w-0 rounded-lg border px-3 py-2.5">
          <div className="text-muted-foreground truncate text-[11px]">{label}</div>
          <div className="mt-0.5 text-2xl font-semibold tracking-tight">
            <InlineBone className={cn("h-6", index % 3 === 0 ? "w-20" : index % 3 === 1 ? "w-14" : "w-16")} />
          </div>
          <div className="mt-0.5 text-[11px]">
            <InlineBone className={cn("h-2.5", index % 2 ? "w-24" : "w-32")} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FounderKpisSkeleton() {
  return <StatSkeletons labels={FOUNDER_LABELS} />;
}

export function KpiGridSkeleton() {
  return <StatSkeletons labels={KPI_LABELS} />;
}

/* ── Panel bodies ───────────────────────────────────────────────────── */

const ASIDE = <InlineBone className="h-2 w-20" />;

/** A `Bars` chart: the plot, then a line of first label · summary · last label. */
function BarsBone({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Bone className="h-24 w-full rounded-sm" />
      <div className="flex justify-between text-[10px]">
        <span><InlineBone className="h-2 w-8" /></span>
        <span><InlineBone className="h-2 w-24" /></span>
        <span><InlineBone className="h-2 w-8" /></span>
      </div>
    </div>
  );
}

/** A `Table`: a header line, then rows at the real row height. */
function TableBone({ rows }: { rows: number }) {
  return (
    <div className="text-xs">
      <div className="pb-1">
        <InlineBone className="h-2.5 w-2/5" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="border-t py-1">
          <InlineBone className={cn("h-3", index % 2 ? "w-4/5" : "w-full")} />
        </div>
      ))}
    </div>
  );
}

function BarsPanel({ title, aside, double = false }: { title: string; aside?: ReactNode; double?: boolean }) {
  return (
    <Panel title={title} aside={aside}>
      <BarsBone />
      {double ? <BarsBone className="mt-2" /> : null}
    </Panel>
  );
}

function TablePanel({ title, aside, rows, children }: { title: string; aside?: ReactNode; rows: number; children?: ReactNode }) {
  return (
    <Panel title={title} aside={aside}>
      <TableBone rows={rows} />
      {children}
    </Panel>
  );
}

/* ── Slots ──────────────────────────────────────────────────────────── */

export function FounderPanelsSkeleton() {
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      <BarsPanel title="MRR · 30 days" aside={ASIDE} />
      <TablePanel title="MRR movement · 30 days" aside={ASIDE} rows={6} />
      <BarsPanel title="Daily active users · 30 days" aside={ASIDE} />
      <TablePanel title="Retention by signup week" aside="came back in week 1–4 after signing up" rows={3} />
      <BarsPanel title="When they use it · 30 days" aside="people in the app, by hour of day" />
      <TablePanel title="Plans and packs" aside="paying, trialing and past-due memberships" rows={3} />
    </div>
  );
}

export function TrendPanelsSkeleton() {
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      <BarsPanel title="Signups · 30 days" />
      <BarsPanel title="New businesses · 30 days" />
      <BarsPanel title="Quotes sent · 30 days" />
      <BarsPanel title="Money collected · 30 days" />
      <BarsPanel title="Everything logged · 30 days" />
      <BarsPanel title="Pulse · last 24 hours" aside="all events · big ones" double />
    </div>
  );
}

export function FunnelPanelSkeleton() {
  return (
    <Panel title="Funnel · last 90 days" aside="people who signed up, then businesses reaching each step · % of the step before">
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="grid grid-cols-[9rem_minmax(0,1fr)_5.5rem] items-center gap-3 text-xs">
            <InlineBone className="h-3 w-24" />
            <Bone className="h-4 rounded-sm" />
            <InlineBone className="ml-auto h-3 w-10" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function OnlinePanelSkeleton() {
  return <TablePanel title="Who's in the app" aside={ASIDE} rows={3} />;
}

export function RevenuePanelSkeleton() {
  return (
    <TablePanel title="Subscriptions" aside={ASIDE} rows={2}>
      <div className="mt-3 mb-1 text-[11px]">
        <InlineBone className="h-2.5 w-36" />
      </div>
      <div className="text-xs">
        <InlineBone className="h-3 w-12" />
      </div>
    </TablePanel>
  );
}

export function ActivityPanelsSkeleton() {
  return (
    <>
      <TablePanel title="Most active · 7 days" rows={3} />
      <TablePanel title="What happened · 24 hours" rows={4} />
    </>
  );
}

export function BusinessesPanelSkeleton() {
  return <TablePanel title="Newest businesses" aside={ASIDE} rows={3} />;
}

export function SupportAndHealthSkeleton() {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <Panel title="Support inbox" aside="problems, ideas and help requests — newest open first">
        <div className="divide-y text-xs">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="py-2">
              <InlineBone className={cn("h-3", index % 2 ? "w-11/12" : "w-full")} />
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-2">
        <TablePanel title="Notification delivery · 24 hours" rows={3}>
          <div className="mt-3 mb-1 text-[11px]">
            <InlineBone className="h-2.5 w-24" />
          </div>
          <div className="text-xs">
            <InlineBone className="h-3 w-12" />
          </div>
        </TablePanel>
        <TablePanel title="Stripe webhooks · latest" rows={5} />
        <TablePanel title="System" rows={10} />
        <TablePanel title="Biggest tables" rows={8} />
      </div>
    </div>
  );
}

/** The live feed while the page itself is still being read. */
export function FeedSkeleton() {
  return (
    <Panel
      title="Live feed"
      aside={ASIDE}
      className="min-h-0 overflow-hidden xl:sticky xl:top-3 xl:h-[calc(100svh-1.5rem)] xl:self-start"
      contentClassName="flex min-h-0 flex-col overflow-hidden"
    >
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1">
        {["w-16", "w-[5.5rem]", "w-[4.5rem]", "w-16", "w-14", "w-16", "w-[4.5rem]"].map((width, index) => (
          <Bone key={index} className={cn("h-[1.375rem] rounded", width)} />
        ))}
      </div>
      <ol className="flex flex-col">
        {Array.from({ length: 14 }, (_, index) => (
          <li key={index} className="flex gap-2 border-b py-1.5 text-xs">
            <Bone className="mt-0.5 size-3.5 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="leading-snug">
                <InlineBone className={cn("h-3", index % 3 === 0 ? "w-3/4" : index % 3 === 1 ? "w-full" : "w-2/3")} />
              </div>
              <div className="text-[10px]">
                <InlineBone className="h-2 w-28" />
              </div>
            </div>
            <InlineBone className="h-2 w-10 shrink-0" />
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function HeaderSkeleton() {
  return (
    <header className="bg-card flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      <span className="font-semibold tracking-tight">ServiceClerk · Live</span>
      <Bone className="h-5 w-24 rounded-full" />
      <span className="text-xs">
        <InlineBone className="h-3 w-[10.5rem]" />
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {/* The header's buttons, at their size (sm, h-7) and their measured widths. */}
        {["w-[8.125rem]", "w-[7.75rem]", "w-[6.5rem]", "w-[6.25rem]", "w-[5.25rem]"].map((width, index) => (
          <Bone key={index} className={cn("h-7", width)} />
        ))}
      </div>
    </header>
  );
}

/**
 * The whole page, for while the server reads it and before the browser takes
 * over. The same layout `Dashboard` draws, slot for slot.
 */
export function DashboardSkeleton() {
  return (
    <div className="flex min-h-svh flex-col gap-2 p-2 md:p-3" aria-busy="true">
      <span className="sr-only">Loading the live dashboard</span>
      <HeaderSkeleton />
      <FounderKpisSkeleton />
      <KpiGridSkeleton />
      <div className="grid min-h-0 gap-2 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-2">
          <FounderPanelsSkeleton />
          <TrendPanelsSkeleton />
          <div className="grid gap-2 lg:grid-cols-2">
            <FunnelPanelSkeleton />
            <OnlinePanelSkeleton />
            <RevenuePanelSkeleton />
            <ActivityPanelsSkeleton />
          </div>
        </div>
        <FeedSkeleton />
      </div>
      <BusinessesPanelSkeleton />
      <SupportAndHealthSkeleton />
    </div>
  );
}
