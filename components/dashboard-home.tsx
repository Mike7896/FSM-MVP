"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Check, ChevronRight, Clock3, Copy, FilePlus2, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DocumentThumbnail } from "@/components/documents/document-thumbnail";
import { ReleaseNotesNews } from "@/components/release-notes/seen";
import type { DashboardData, DashboardRow, DashboardScheduleItem } from "@/lib/queries/dashboard";
import type { StartState } from "@/lib/queries/activation";
import { formatMoney } from "@/lib/quote";
import { cn } from "@/lib/utils";

type Props = {
  organizationId: string;
  initialData: DashboardData;
  businessName: string | null;
  license: string | null;
  start: StartState;
};

const subscribe = () => () => {};

export function DashboardHome({ initialData, organizationId, ...props }: Props) {
  const timeZone = useSyncExternalStore(subscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => "UTC");
  const query = useQuery({
    queryKey: ["dashboard", organizationId, timeZone],
    queryFn: async (): Promise<DashboardData> => {
      const response = await fetch(`/api/v1/dashboard?${new URLSearchParams({ tz: timeZone })}`);
      if (!response.ok) throw new Error("The daily briefing couldn't refresh.");
      const body = await response.json();
      return body.data;
    },
    placeholderData: initialData,
    refetchInterval: 60_000,
  });
  return <DashboardContent {...props} data={query.data ?? initialData} refreshFailed={query.isError} />;
}

/** Presentation is shared by the live page and populated layout checks. */
export function DashboardContent({ data, businessName, license, start, refreshFailed = false }: Omit<Props, "initialData" | "organizationId"> & { data: DashboardData; refreshFailed?: boolean }) {
  const dueTasks = data.thisWeek.filter((item) => item.kind === "task" && item.on <= data.today);
  const today = data.thisWeek.filter((item) => item.kind !== "task" && item.on === data.today);
  const upcoming = data.thisWeek.filter((item) => item.on > data.today);
  const followUps = data.waitingOnCustomer.filter((row) => row.needsAction);
  const waiting = data.waitingOnCustomer.filter((row) => !row.needsAction);
  const hasActions = dueTasks.length + data.moneyToCollect.rows.length + data.clearedToProceed.length + followUps.length > 0;
  const demo = start.realQuotes === 0 ? start.demoQuote : null;
  const date = new Date(`${data.today}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });

  // Decide after the timezone-aware refresh too: a local late-night visit can
  // still be today even when the initial server date has rolled forward.
  if (!hasActions && data.thisWeek.length === 0 && waiting.length === 0 && start.realQuotes === 0 && !demo) {
    return (
      <div className="mx-auto w-full max-w-3xl py-6 md:py-12">
        <div className="rounded-2xl border bg-muted/25 p-6 sm:p-10 dark:bg-card">
          <p className="text-muted-foreground text-xs font-medium tracking-wide">{businessName || "Your daily briefing"}</p>
          <h1 className="font-heading mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">Your next job starts here.</h1>
          <p className="text-muted-foreground mt-4 max-w-lg text-base leading-relaxed">Start with a quote. As work comes in, this space brings together your appointments, customer follow-ups and money ready to collect.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="h-11 px-4"><Link href="/quotes/new"><FilePlus2 /> Start a quote</Link></Button>
            <Button asChild variant="outline" className="h-11 px-4"><Link href="/welcome">Walk me through it <ArrowRight /></Link></Button>
          </div>
          {refreshFailed ? <p role="status" className="text-muted-foreground mt-4 text-sm">Couldn&apos;t refresh this briefing. Showing the last loaded information.</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide">{date}</p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Your day, in focus.</h1>
          <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-relaxed">
            {hasActions ? "A few next steps to keep work moving and money coming in." : "Room to plan ahead. Your schedule and recent work are right here."}
          </p>
        </div>
        <Link href="/schedule" className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-2 text-sm">
          <CalendarDays className="size-4" /> Open schedule <ArrowRight className="size-4" />
        </Link>
      </header>

      {refreshFailed ? <p role="status" className="rounded-lg border px-4 py-3 text-sm">Couldn&apos;t refresh this briefing. Showing the last loaded information.</p> : null}
      {demo ? <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm">Your demo is practice. Only real jobs, appointments and money appear in this briefing.</p> : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {hasActions ? (
            <section aria-labelledby="next-steps" className="overflow-hidden rounded-2xl border bg-card">
              <div className="border-b px-5 py-5 sm:px-6">
                <p className="text-primary-ink mb-1 text-xs font-semibold">NEXT STEPS</p>
                <h2 id="next-steps" className="text-xl font-semibold tracking-tight">Worth your attention</h2>
              </div>
              <div className="divide-y px-5 sm:px-6">
                {dueTasks.length > 0 ? <ActionGroup title="Tasks due" rows={dueTasks.map((item) => ({
                  sentence: item.title, detail: `${item.overdue ? "Overdue" : "Due today"}${item.address ? ` · ${item.address}` : ""}`,
                  action: "Open task", href: item.href,
                }))} prominent /> : null}
                {data.moneyToCollect.rows.length > 0 ? <ActionGroup title="Ready to bill & collect" detail={`${formatMoney(data.moneyToCollect.totalCents)} across these items`} rows={data.moneyToCollect.rows} prominent={dueTasks.length === 0} /> : null}
                {data.clearedToProceed.length > 0 ? <ActionGroup title="Cleared to proceed" rows={data.clearedToProceed} prominent={dueTasks.length === 0 && data.moneyToCollect.rows.length === 0} /> : null}
                {followUps.length > 0 ? <ActionGroup title="Ready for a follow-up" rows={followUps} /> : null}
              </div>
            </section>
          ) : (
            <section className="relative overflow-hidden rounded-2xl border bg-muted/25 p-6 sm:p-8 dark:bg-card">
              <div className="bg-background dark:bg-muted mb-7 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium">
                <Check className="size-3.5" /> No outstanding actions in this briefing
              </div>
              <div className="max-w-md">
                <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Make room for the next job.</h2>
                <p className="text-muted-foreground mt-3 text-sm leading-relaxed">Start a fresh quote, pick up a draft, or use past work as a starting point. Everything you need is a click away.</p>
              </div>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild className="h-11 px-4"><Link href="/quotes/new"><FilePlus2 /> Start a quote</Link></Button>
                <Button asChild variant="outline" className="h-11 px-4"><Link href="/quotes">Open quotes <ArrowRight /></Link></Button>
              </div>
            </section>
          )}
          {waiting.length > 0 ? <section className="rounded-2xl border bg-card px-5 sm:px-6"><ActionGroup title="With your customers" detail="Recently sent or viewed. No follow-up suggested yet." rows={waiting} /></section> : null}
        </div>

        <aside className="order-first min-w-0 rounded-2xl border bg-card xl:order-last" aria-label="Your schedule">
          <div className="flex items-center justify-between border-b px-5 py-5">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold"><CalendarDays className="text-muted-foreground size-5" /> Today</h2>
            <span className="text-muted-foreground text-xs">{today.length ? `${today.length} planned` : "An open day"}</span>
          </div>
          <div className="px-5">
            {today.length ? <ScheduleList items={today} timeZone={data.timeZone} today /> : (
              <div className="py-6">
                <p className="font-medium">No visits or inspections today.</p>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{dueTasks.length ? "Your due tasks are under Next steps." : "Book time for a job or leave space for what comes in."}</p>
                <Link href="/schedule" className="text-primary-ink mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium">Plan your day <ArrowRight className="size-4" /></Link>
              </div>
            )}
            <div className="border-t pb-3 pt-5">
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide">COMING UP · NEXT 6 DAYS</h3>
              {upcoming.length ? <ScheduleList items={upcoming} timeZone={data.timeZone} /> : <p className="text-muted-foreground py-3 text-sm">Nothing else scheduled this week.</p>}
            </div>
          </div>
        </aside>
      </div>

      {data.quickStart.length > 0 ? (
        <section aria-labelledby="quote-again">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div><h2 id="quote-again" className="text-lg font-semibold tracking-tight">A head start on your next quote</h2><p className="text-muted-foreground mt-1 text-sm">Reuse the scope. Adjust it for the next customer.</p></div>
            <Link href="/quotes" className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-2 text-sm">All quotes <ArrowRight className="size-4" /></Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {data.quickStart.map((item) => (
              <Link key={item.id} href={item.href} className="group hover:border-primary/50 focus-visible:ring-ring flex min-w-0 items-center gap-5 rounded-xl border bg-muted/20 p-5 transition-colors focus-visible:ring-2 dark:bg-card">
                <div aria-hidden className="document-paper pointer-events-none w-20 shrink-0 overflow-hidden bg-white shadow-sm ring-1 ring-paper-edge sm:w-24">
                  <DocumentThumbnail businessName={businessName} license={license} customerName={item.customerName} title={item.title} number={item.number} rows={item.rows} totalCents={item.totalCents} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{item.title || "Untitled quote"}</p>
                  <p className="text-muted-foreground mt-1 truncate text-sm">{item.customerName}</p>
                  <p className="mt-2 text-sm tabular-nums">{formatMoney(item.totalCents)}</p>
                  <span className="text-primary-ink mt-4 inline-flex items-center gap-2 text-sm font-medium"><Copy className="size-3.5" /> Use as a starting point</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {start.realSent === 0 ? (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed p-5">
          <div><h2 className="font-medium">{start.realDraft ? "Your first quote is saved." : "Ready to quote a real job?"}</h2><p className="text-muted-foreground mt-1 text-sm">{start.realDraft ? "Pick up where you left off and send it when you're ready." : "The walkthrough takes you from scope to a quote you can send."}</p></div>
          <Button asChild variant="outline" className="h-11 px-4"><Link href={start.realDraft ? `/quotes/${start.realDraft.id}` : "/welcome"}>{start.realDraft ? "Continue quote" : "Start walkthrough"}<ArrowRight /></Link></Button>
          {demo ? <Link href={demo.sentAt ? `/quotes/${demo.id}/sent` : `/quotes/${demo.id}`} className="text-muted-foreground inline-flex min-h-11 items-center text-sm underline underline-offset-4">Open your demo</Link> : null}
        </section>
      ) : null}
      <div className="border-t pt-5"><ReleaseNotesNews /></div>
    </div>
  );
}

function ActionGroup({ title, detail, rows, prominent = false }: { title: string; detail?: string; rows: DashboardRow[]; prominent?: boolean }) {
  return <section className="py-5">
    <div className="mb-2"><h3 className="text-sm font-semibold">{title}</h3>{detail ? <p className="text-muted-foreground mt-1 text-xs">{detail}</p> : null}</div>
    <div className={cn(prominent && "border-foreground/70 border-l-2 pl-4")}>
      {rows.slice(0, 3).map((row, i) => <ActionRow key={`${row.href}-${i}`} row={row} primary={prominent && i === 0} />)}
      {rows.length > 3 ? <details className="mt-2"><summary className="text-primary-ink min-h-11 cursor-pointer py-3 text-sm">Show {rows.length - 3} more</summary>{rows.slice(3).map((row, i) => <ActionRow key={`${row.href}-${i}`} row={row} />)}</details> : null}
    </div>
  </section>;
}

function ActionRow({ row, primary = false }: { row: DashboardRow; primary?: boolean }) {
  return <div className="flex flex-col items-start gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0"><p className="text-sm leading-relaxed [overflow-wrap:anywhere]">{row.sentence.split(/(\*\*[^*]+\*\*)/).map((part, i) => part.startsWith("**") ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong> : part)}</p><p className="text-muted-foreground mt-1 text-xs leading-relaxed [overflow-wrap:anywhere]">{row.detail}</p></div>
    <Button asChild variant={primary ? "default" : "outline"} className="h-11 px-3"><Link href={row.href}>{row.action}<ChevronRight className="size-3.5" /></Link></Button>
  </div>;
}

function ScheduleList({ items, timeZone, today = false }: { items: DashboardScheduleItem[]; timeZone: string; today?: boolean }) {
  const row = (item: DashboardScheduleItem) => <li key={item.key} className="border-b last:border-b-0">
    <Link href={item.href} className="hover:bg-muted/50 focus-visible:ring-ring -mx-2 flex min-w-0 items-start gap-3 rounded-lg px-2 py-4 focus-visible:ring-2">
      <div className="min-w-0 flex-1">
        <p className="text-primary-ink mb-1.5 flex items-center gap-1.5 text-xs font-medium"><Clock3 className="size-3.5" />{item.at ? new Date(item.at).toLocaleString("en-US", { timeZone, ...(today ? {} : { weekday: "short" as const }), hour: "numeric", minute: "2-digit" }) : today ? "All day" : item.when}</p>
        <p className="text-sm font-medium leading-relaxed [overflow-wrap:anywhere]">{item.title}</p>
        {item.address ? <p className="text-muted-foreground mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed"><MapPin className="mt-0.5 size-3 shrink-0" />{item.address}</p> : null}
      </div><ChevronRight className="text-muted-foreground mt-6 size-4 shrink-0" />
    </Link>
  </li>;
  return <><ul>{items.slice(0, 4).map(row)}</ul>{items.length > 4 ? <details><summary className="text-primary-ink min-h-11 cursor-pointer py-3 text-sm">Show {items.length - 4} more</summary><ul>{items.slice(4).map(row)}</ul></details> : null}</>;
}
