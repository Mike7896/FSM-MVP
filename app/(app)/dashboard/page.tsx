import Link from "next/link";
import type { Metadata } from "next";

import { ReleaseNotesNews } from "@/components/release-notes/seen";
import { DemoChip } from "@/components/demo-chip";
import { DocumentCard } from "@/components/documents/document-card";
import { PageHeader } from "@/components/page-header";
import { LocalWhen } from "@/components/schedule/local-when";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization } from "@/lib/dal";
import { getStartState, type StartState } from "@/lib/queries/activation";
import { getDashboard } from "@/lib/queries/dashboard";
import { getOfficeIdentity } from "@/lib/queries/office";
import { formatMoney } from "@/lib/quote";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Screen 25 · Flow 9 · class A·B.
 *
 * It answers one question — *what am I cleared, required, or smart to do next?*
 * — in five seconds, or it has failed. The force it fights is habit: the
 * whiteboard and the text thread are still sitting right there.
 *
 * Two rules this screen exists to hold:
 * - **Every row is a sentence about a real job with a verb attached.** Not one
 *   metric on the surface. A stat-card homepage is the named anti-pattern.
 * - **Escalation is structural, never chromatic.** A row escalates by becoming
 *   an object — framed, thick left edge, promoted number, changed verb.
 *
 * Sections are ordered by cost of inaction, and the action sections collapse
 * out of existence when empty: an empty gate list is a good outcome, not a
 * state to display.
 *
 * **Two conditions from Journey 0 the states have to survive.** An account with
 * nothing in it at all gets the one state that looks like onboarding (21d). An
 * account holding only a demo reads empty — every flagged object is left out
 * of every section — so the screen says why, once, rather than looking broken
 * to the contractor who just watched a demo go out (23a).
 */

/** Renders the `**name**` emphasis used in the row sentences. */
function Sentence({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith("**") ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function SectionLabel({
  children,
  total,
}: {
  children: React.ReactNode;
  total?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold tracking-tight">
        {children}
      </h2>
      {total ? (
        <span className="text-xs font-semibold tabular-nums">{total}</span>
      ) : null}
    </div>
  );
}

function Row({
  sentence,
  detail,
  action,
  href,
  variant = "outline",
}: {
  sentence: string;
  detail: string;
  action: string;
  href: string;
  variant?: "default" | "outline";
}) {
  return (
    <div className="flex flex-col items-start justify-between gap-3 border-t py-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed">
          <Sentence text={sentence} />
        </p>
        <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">{detail}</p>
      </div>
      <Button asChild variant={variant} size="sm" className="shrink-0">
        <Link href={href}>{action}</Link>
      </Button>
    </div>
  );
}

export default async function DashboardPage() {
  const org = await requireActiveOrganization();

  const [dashboard, office, start] = await Promise.all([
    getDashboard(org.id),
    getOfficeIdentity(org.id),
    getStartState(org.id),
  ]);

  const {
    clearedToProceed,
    waitingOnCustomer,
    moneyToCollect,
    thisWeek,
    quickStart,
    needsYou,
  } = dashboard;

  const inFlight =
    clearedToProceed.length > 0 ||
    waitingOnCustomer.length > 0 ||
    moneyToCollect.rows.length > 0 ||
    thisWeek.length > 0;

  // 21d — signed up, skipped the start, made nothing.
  if (!inFlight && start.realQuotes === 0 && !start.demoQuote) {
    return <ColdEmpty businessName={office.businessName} />;
  }

  // 23a — nothing real yet, only the demo.
  const demo = start.realQuotes === 0 ? start.demoQuote : null;

  // Until the first real send the start stays one row away (21b), and never
  // after it.
  const resume = start.realSent === 0 ? resumeRow(start) : null;

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="mx-auto flex w-full max-w-(--workspace-max-width) flex-col gap-10">
      <PageHeader
        title={today}
        description={
          demo
            ? "Nothing real out yet"
            : needsYou > 0
              ? `${needsYou} thing${needsYou === 1 ? "" : "s"} need${needsYou === 1 ? "s" : ""} you`
              : "Nothing needs you"
        }
      />

      {/* What landed since this browser last looked — the one place somebody
          finds out the product moved without going looking. It removes itself
          once it has been read. */}
      <ReleaseNotesNews />

      {/* The exclusion is stated, not discovered. Silence here reads as a
          broken product to the one contractor who has just watched a demo go
          out. */}
      {demo ? (
        <section className="rounded-xl border p-5">
          <p className="text-sm font-medium">Nothing needs you yet.</p>
          <p className="text-muted-foreground mt-1 max-w-prose text-sm">
            Your demo is in Quotes, labelled. Nothing on it counts here — a
            demo deposit isn&apos;t money, so it never shows up in what
            you&apos;re owed.
          </p>
        </section>
      ) : null}

      {/* The one framed block on the surface: this section is permission, and
          gate errors cost in both directions. Framing it is the hierarchy. */}
      {clearedToProceed.length > 0 ? (
        <section className="border-primary/60 bg-primary/[0.03] rounded-xl border p-5">
          <SectionLabel>Cleared to proceed</SectionLabel>
          <div className="[&>div:first-of-type]:border-t-0">
            {clearedToProceed.map((row, i) => (
              <Row
                key={row.href + i}
                sentence={row.sentence}
                detail={row.detail}
                action={row.action}
                href={row.href}
                variant={i === 0 ? "default" : "outline"}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
        {/* Left column: things people are doing to you. */}
        <div className="flex flex-col gap-8">
          {waitingOnCustomer.length > 0 ? (
            <section>
              <SectionLabel>Waiting on customer</SectionLabel>
              {waitingOnCustomer.map((row) => (
                <Row
                  key={row.href}
                  sentence={row.sentence}
                  detail={row.detail}
                  action={row.action}
                  href={row.href}
                />
              ))}
            </section>
          ) : null}

          {moneyToCollect.rows.length > 0 ? (
            <section>
              <SectionLabel total={formatMoney(moneyToCollect.totalCents)}>
                Money to collect
              </SectionLabel>
              {moneyToCollect.rows.map((row, i) => (
                <Row
                  key={row.href + i}
                  sentence={row.sentence}
                  detail={row.detail}
                  action={row.action}
                  href={row.href}
                />
              ))}
            </section>
          ) : null}
        </div>

        {/* Right column: things you're doing. Always renders — "nothing
            scheduled" is information, where an empty gate list is not. */}
        <div className="flex flex-col gap-8">
          <section>
            <SectionLabel>This week</SectionLabel>
            {thisWeek.length > 0 ? (
              thisWeek.map((item) => (
                <div
                  key={item.key}
                  className="flex items-baseline justify-between gap-6 border-t py-4"
                >
                  <div>
                    <p className="text-sm">{item.title}</p>
                    {item.address ? (
                      <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                        {item.address}
                      </p>
                    ) : null}
                  </div>
                  <span className="text-muted-foreground shrink-0 text-sm">
                    {item.at ? <LocalWhen at={item.at} /> : item.when}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground border-t py-4 text-sm">
                Nothing scheduled
              </p>
            )}
          </section>

          {/* **The one section here that is recognition rather than triage.**
              Every other row on this surface is a sentence with a verb — that
              rule is what keeps the dashboard from becoming a stat-card
              homepage, and document cards would break it. This section is
              different in kind: it asks *which past quote do I start from*, and
              the fastest way to price the next panel swap is the last panel
              swap. Picking one is recognising it, which is exactly what a
              miniature of the page does and a text label does not.

              A demo appears here and nowhere above: this is an entry point,
              not a claim about his business, and a flagged object can never
              open a gate or be owed. */}
          {demo || quickStart.length > 0 ? (
            <section>
              <SectionLabel>Quick start</SectionLabel>
              {demo ? (
                <>
                  <Row
                    sentence="Quote a real job"
                    detail="Same screens as the demo, and it goes to your customer."
                    action="Start"
                    href="/welcome"
                    variant="default"
                  />
                  <DemoRow quote={demo} />
                </>
              ) : null}
              {quickStart.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 pt-1 sm:grid-cols-2 xl:grid-cols-3">
                  {quickStart.map((item) => (
                    <DocumentCard
                      key={item.id}
                      href={item.href}
                      businessName={office.businessName}
                      license={office.license}
                      customerName={item.customerName}
                      title={item.title}
                      number={item.number}
                      rows={item.rows}
                      totalCents={item.totalCents}
                      status="Duplicate"
                      standing={undefined}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* Low on the screen, and only until the first real send. An offer,
              never a nag bar. */}
          {resume ? (
            <section className="flex flex-col items-start justify-between gap-4 rounded-xl border p-5 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <p className="text-sm font-medium">{resume.sentence}</p>
                <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                  {resume.detail}
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link href={resume.href}>{resume.action}</Link>
              </Button>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * 21d · signed up, start skipped, nothing created.
 *
 * Not a checklist and not a completion meter — the first quote is the
 * onboarding, so this points straight back into Flow 1 and offers the
 * walkthrough beside it rather than imposing it.
 */
function ColdEmpty({ businessName }: { businessName: string | null }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 py-6 md:py-12">
      <div>
        {businessName ? (
          <p className="text-muted-foreground font-label text-[11px] uppercase">
            {businessName}
          </p>
        ) : null}
        <h1 className="mt-3 text-3xl leading-tight font-semibold tracking-tight">
          Quote your next job.
        </h1>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          One sentence about the work is enough to start. About ten minutes,
          and it&apos;s with your customer.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href="/quotes/new">Start a quote</Link>
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link href="/welcome">Walk me through it instead</Link>
        </Button>
      </div>
    </div>
  );
}

/** The resume row's words, chosen by what he has so far. */
function resumeRow(start: StartState) {
  if (start.realDraft) {
    return {
      sentence: "Your first quote isn't out yet.",
      detail: "It's saved right where you left it.",
      action: "Pick it up",
      href: `/quotes/${start.realDraft.id}`,
    };
  }

  // On this account the tour has already run once, so the verb points at the
  // real quote instead of at the walkthrough.
  if (start.demoQuote) {
    return {
      sentence: "You've done the demo. The real one takes ten minutes.",
      detail: "Same screens, and it goes to your customer.",
      action: "Resume tour",
      href: "/welcome",
    };
  }

  return {
    sentence: "You skipped the walkthrough last time.",
    detail: "Two minutes, on a real quote.",
    action: "Resume tour",
    href: "/welcome",
  };
}

/** The demo, labelled — reachable from here, counted nowhere. */
function DemoRow({ quote }: { quote: NonNullable<StartState["demoQuote"]> }) {
  const when = quote.sentAt
    ? `sent to you ${day(quote.sentAt)}`
    : `started ${day(quote.createdAt)}`;

  return (
    <div className="flex flex-col items-start justify-between gap-3 border-t py-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-sm leading-relaxed">
          <span className="truncate">{quote.title || quote.customerName}</span>
          <DemoChip />
        </p>
        <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
          {formatMoney(quote.totalCents)} · {when}
        </p>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link
          href={
            quote.sentAt ? `/quotes/${quote.id}/sent` : `/quotes/${quote.id}`
          }
        >
          Open
        </Link>
      </Button>
    </div>
  );
}

/** "today", "Tuesday", or a date once it's more than a week back. */
function day(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "today";
  return now.getTime() - date.getTime() < 6 * 86_400_000
    ? date.toLocaleDateString("en-US", { weekday: "long" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
