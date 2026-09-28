import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Screen 49 · the per-trade front door · class B·W, Flow 17.
 *
 * **One skeleton, swappable content.** The campaign layer gets its own
 * headline, proof and SEO surface with the same product underneath — never a
 * divergent sub-brand, because a contractor can run several packs at once.
 *
 * A visitor arriving here lands in the same signup and the same first-quote
 * flow as one arriving on `/`; the trade is simply pre-selected.
 */

const TRADES: Record<
  string,
  { name: string; headline: string; hook: string; jobs: string[] }
> = {
  electricians: {
    name: "Electricians",
    headline: "Quoting software that knows what a panel upgrade is.",
    hook: "EV chargers, service upgrades and backup power — priced by wire gauge and footage, with permits as first-class lines and code-aware scope language.",
    jobs: [
      "EV charger install",
      "Panel / service upgrade",
      "Backup power",
      "Remodel electrical",
    ],
  },
  plumbers: {
    name: "Plumbers",
    headline: "Quoting software that prices by pipe, not by guess.",
    hook: "Water heaters, repipes and sewer lines — priced by pipe type and diameter, with backflow permits handled as named lines.",
    jobs: ["Water heater swap", "Repipe", "Sewer line", "Fixture set"],
  },
};

export async function generateMetadata({
  params,
}: PageProps<"/for/[trade]">): Promise<Metadata> {
  const { trade } = await params;
  const config = TRADES[trade];
  return {
    title: config ? `For ${config.name}` : "For your trade",
  };
}

export default async function TradePage({ params }: PageProps<"/for/[trade]">) {
  const { trade } = await params;
  const config = TRADES[trade] ?? {
    name: trade.charAt(0).toUpperCase() + trade.slice(1),
    headline: "Job management built around your trade.",
    hook: "The core runs every trade's money workflow. Trade packs add the job types, templates and language specific to yours.",
    jobs: [],
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="max-w-2xl">
        <p className="text-muted-foreground font-label text-xs uppercase">
          ServiceClerk for {config.name}
        </p>
        <h1 className="mt-4 text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
          {config.headline}
        </h1>
        <p className="text-muted-foreground mt-5 text-lg leading-relaxed">
          {config.hook}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={`/signup?trade=${trade}`}>
              Start your first quote
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/pricing">See pricing</Link>
          </Button>
        </div>
      </div>

      {config.jobs.length > 0 ? (
        <section className="mt-20 border-t pt-12">
          <h2 className="text-2xl font-semibold tracking-tight">
            The jobs you actually quote
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {config.jobs.map((job) => (
              <div key={job} className="rounded-lg border p-5">
                <p className="font-medium">{job}</p>
                <p className="text-muted-foreground mt-1.5 text-sm">
                  Templated, with the scope language already written.
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-16 border-t pt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          The same product, either way
        </h2>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          The core runs the money workflow for every trade — quote, deposit,
          change orders, progress billing, final invoice. The {config.name}{" "}
          pack makes all of it speak your trade.
        </p>
      </section>
    </div>
  );
}
