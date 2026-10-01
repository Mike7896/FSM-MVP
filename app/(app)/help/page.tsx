import type { Metadata } from "next";
import Link from "next/link";
import { Bug, ChevronRight, Lightbulb, LifeBuoy } from "lucide-react";

import { HelpBrowser } from "@/components/help/help-browser";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/dal";
import { listSupportRequests, STATUS_LABELS, SUPPORT_KINDS, supportKind } from "@/lib/support";
import { cn } from "@/lib/utils";

import { contactHref, pageFrom } from "./help-links";

export const metadata: Metadata = { title: "Help" };

const ICONS = { bug: Bug, idea: Lightbulb, help: LifeBuoy } as const;

/**
 * Help — the articles, the common questions, and a person.
 *
 * **A person is on the first screen, not at the bottom of the last one.** The
 * three ways to reach us sit above the articles, not behind a "did this help?"
 * gate: someone who already knows they need a human shouldn't have to prove
 * the articles failed them first.
 *
 * Not "Learn": that's the tour set (Content Design §8). Help is reference —
 * looked up when stuck — and the way to a person.
 *
 * `?from` is the page they opened Help from, carried to the request form so a
 * problem report says where it happened without asking.
 */
export default async function HelpPage({ searchParams }: PageProps<"/help">) {
  const [session, params] = await Promise.all([requireSession(), searchParams]);
  const from = pageFrom(params.from);
  const sent = await listSupportRequests(session.userId, 10);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      <PageHeader
        title="Help"
        description="How things work, answers to common questions, and a way to reach a person."
      />

      {/* A person, first. */}
      <section aria-label="Contact us" className="grid gap-3 sm:grid-cols-3">
        {SUPPORT_KINDS.map((entry) => {
          const Icon = ICONS[entry.kind];
          return (
            <Link
              key={entry.kind}
              href={contactHref(entry.kind, from)}
              className="hover:border-foreground/25 hover:bg-muted/30 group flex gap-3 rounded-xl border p-3 transition-colors sm:flex-col sm:gap-2 sm:p-4"
            >
              <Icon className={cn("mt-0.5 size-5 shrink-0 sm:mt-0", entry.kind === "help" ? "text-primary-ink" : "text-muted-foreground")} />
              <span className="flex min-w-0 flex-col gap-0.5 sm:gap-2">
                <span className="flex items-center gap-1 text-sm font-medium">
                  {entry.label}
                  <ChevronRight className="text-muted-foreground size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="text-muted-foreground text-xs leading-relaxed">{entry.lead}</span>
              </span>
            </Link>
          );
        })}
      </section>

      <HelpBrowser contactHref={contactHref("help", from)} />

      {sent.length ? (
        <section aria-label="What you've sent">
          <h2 className="text-muted-foreground mb-2 font-label text-[11px] uppercase">What you&apos;ve sent</h2>
          <ul className="divide-y rounded-xl border">
            {sent.map((request) => (
              <li key={request.id} className="flex items-baseline gap-3 px-4 py-3">
                <span className="text-muted-foreground w-16 shrink-0 text-xs">{supportKind(request.kind).short}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{request.subject}</span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  #{request.number} · {STATUS_LABELS[request.status]}{" "}
                  {new Date(request.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-2 text-xs">Answers come by email to {session.email}.</p>
        </section>
      ) : null}
    </div>
  );
}
