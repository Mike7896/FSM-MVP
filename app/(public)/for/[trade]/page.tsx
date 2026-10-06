import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "./trade.module.css";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pickerPricing } from "@/lib/membership/bill";
import { getReleases } from "@/lib/membership/releases";
import { POLICY } from "@/lib/membership/catalog";
import { formatMoney } from "@/lib/quote/money";

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
  { name: string; headline: string; hook: string; coreHook: string; sample: string; scope: string[]; jobs: string[] }
> = {
  electricians: {
    name: "Electricians",
    coreHook: "Quote a service upgrade, schedule the visit, and bill as the work gets done. Keep the customer, scope, and payments on the same job.",
    sample: "Kitchen electrical renovation",
    scope: ["Recessed lighting and dedicated circuits", "Panel work, wiring, and installation", "Deposit, rough-in, and final billing"],
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
    coreHook: "From a water heater replacement to a bigger remodel, keep your scope, customer approvals, and invoices together. Spend less of the evening piecing the job back together.",
    sample: "Bathroom plumbing remodel",
    scope: ["Supply lines and fixture installation", "Drain work and finish connections", "Deposit, rough-in, and final billing"],
    headline: "Quoting software that prices by pipe, not by guess.",
    hook: "Water heaters, repipes and sewer lines — priced by pipe type and diameter, with backflow permits handled as named lines.",
    jobs: ["Water heater swap", "Repipe", "Sewer line", "Fixture set"],
  },
  roofers: {
    name: "Roofers",
    headline: "Keep the roof work and the paperwork together.",
    hook: "",
    coreHook: "Put the scope in writing, collect a deposit, and keep extra work and final billing connected to the roof you’re working on.",
    sample: "Residential roof replacement",
    scope: ["Tear-off and disposal", "Underlayment, flashing, and shingles", "Deposit and final billing"],
    jobs: ["Roof replacement", "Leak repair", "Flashing repair", "Outbuilding roof"],
  },
  remodelers: {
    name: "Remodelers",
    headline: "A clear record for a job with moving parts.",
    hook: "",
    coreHook: "Keep a longer project organized from the first quote through the last invoice. Capture changes in writing and bill as the work progresses.",
    sample: "Kitchen renovation",
    scope: ["Demolition and preparation", "Cabinetry and finish installation", "Deposit, progress, and final billing"],
    jobs: ["Kitchen remodel", "Bathroom remodel", "Basement finish", "Interior renovation"],
  },
};

export async function generateMetadata({
  params,
}: PageProps<"/for/[trade]">): Promise<Metadata> {
  const { trade } = await params;
  const config = Object.hasOwn(TRADES, trade) ? TRADES[trade] : undefined;
  return {
    title: config ? `Job management for ${config.name.toLowerCase()}` : "For your trade",
    description: config?.coreHook,
  };
}

export default async function TradePage({ params }: PageProps<"/for/[trade]">) {
  const { trade } = await params;
  const config = Object.hasOwn(TRADES, trade) ? TRADES[trade] : undefined;
  if (!config) notFound();

  const releases = await getReleases();
  const released = trade === "electricians" && releases.pack_electrical;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <div className={styles.hero}>
      <div className="max-w-2xl">
        <p className="text-muted-foreground font-label text-xs uppercase">
          ServiceClerk for {config.name}
        </p>
        <h1 className="mt-4 text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
          {released ? config.headline : `From first quote to final payment, for ${config.name.toLowerCase()}.`}
        </h1>
        <p className="text-muted-foreground mt-5 text-lg leading-relaxed">
          {released ? config.hook : config.coreHook}
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
        <p className="mt-5 text-sm text-muted-foreground">Three free jobs each month. No credit card needed.</p>
      </div>
      <figure className={styles.job}>
        <figcaption>Illustrative job · Your scope, your prices</figcaption>
        <h2>{config.sample}</h2>
        <p>Prepared for the Morgan residence</p>
        <ul>{config.scope.map((line) => <li key={line}>{line}</li>)}</ul>
        <div><span>Quote</span><ArrowRight size={14} aria-hidden="true" /><span>Contract</span><ArrowRight size={14} aria-hidden="true" /><span>Invoice</span></div>
        <p>One job record, from the first number to the last payment.</p>
      </figure>
      </div>

      {config.jobs.length > 0 ? (
        <section className="mt-20 border-t pt-12">
          <h2 className="text-2xl font-semibold tracking-tight">
            The jobs you actually quote
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {config.jobs.map((job) => (
              <div key={job} className="rounded-2xl border bg-card p-6 sm:p-8">
                <p className="font-medium">{job}</p>
                <p className="text-muted-foreground mt-1.5 text-sm">
                  {released ? "Templated, with the scope language already written." : "Quote this work today with your own line items and scope."}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.workflow}>
        <div><h2>Keep the work moving.<br />Keep the paperwork with it.</h2><p>The quote is only the beginning. ServiceClerk carries the job through the decisions, changes, and payments that follow.</p><Link href="/#product-tour" className="inline-flex items-center gap-2 py-3 text-sm font-medium underline underline-offset-4">Walk through a sample job <ArrowRight size={16} /></Link></div>
        <dl>
          <div><dt>A clear agreement</dt><dd>Generate a contract from the quote, collect a signature, and request a percentage-based deposit.</dd></div>
          <div><dt>A record of extra work</dt><dd>Send a change order when the scope changes, so the added work and agreed price stay with the job.</dd></div>
          <div><dt>Payments as you go</dt><dd>Bill in phases, track what has been received, and see what remains before the final invoice.</dd></div>
          <div><dt>An easier handoff to the homeowner</dt><dd>Share documents through a browser link. Your customer can review, sign, and pay where enabled, without an account.</dd></div>
        </dl>
      </section>
      {trade === "electricians" ? <ElectricianPricing /> : null}

      <section className="mt-16 border-t pt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          Useful today. Room to grow.
        </h2>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          The core runs the money workflow for every trade — quote, deposit,
          change orders, progress billing, final invoice. Use your own line items and scope today.
          {trade === "electricians" ? (released
            ? " The Electrical pack adds specialist templates and language."
            : " The Electrical pack is in development and is not included in a paid plan yet.") : ""}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">Saved items are included with Starter and Pro. Your logo is available on Pro. Online payments require an approved Stripe account; processing fees apply.</p>
        <div className="mt-8 flex flex-wrap items-center gap-5"><Button asChild size="lg"><Link href={`/signup?trade=${trade}`}>Start your first quote <ArrowRight /></Link></Button><Link href="/pricing" className="text-sm underline underline-offset-4">Compare all plans</Link></div>
      </section>
    </div>
  );
}

/**
 * What an electrician actually pays — Billing §12: **the total first**, core
 * and pack together, with the arithmetic under it. Until the Electrical pack
 * is released it isn't sold, so the page quotes the core and says the pack is
 * coming rather than advertising a price nobody can pay.
 */
async function ElectricianPricing() {
  const pricing = await pickerPricing(null);
  const pack = pricing.packs.electrical;
  const core = pricing.core;
  const offers: { title: string; body: string }[] = [];

  if (pricing.electricalAvailable && core.starter.month !== null && pack.month !== null) {
    offers.push({
      title: `Starter for electricians — ${formatMoney(core.starter.month + pack.month)}/month plus applicable tax`,
      body: `Includes the ${formatMoney(core.starter.month)} ServiceClerk core and the ${formatMoney(pack.month)} Electrical pack. Unlimited jobs, quotes, contracts, deposits, progress invoices and payment collection. Payment processing fees apply separately.`,
    });
    if (pricing.proAvailable && core.pro.month !== null) {
      offers.push({
        title: `Pro for electricians — ${formatMoney(core.pro.month + pack.month)}/month plus applicable tax`,
        body: "Everything in Starter for electricians, plus your logo, quote-view tracking and business analytics.",
      });
    }
    if (core.starter.year !== null && pack.year !== null) {
      const year = core.starter.year + pack.year;
      offers.push({
        title: `Annual Starter for electricians — ${formatMoney(year)} billed annually`,
        body: `Equivalent to ${formatMoney(Math.round(year / 12), { forceCents: true })}/month; save ${formatMoney((core.starter.month + pack.month) * 12 - year)} compared with 12 monthly payments.`,
      });
    }
    offers.push({
      title: "Free — activate three jobs each month",
      body: `Finish and collect payment on those jobs without using another slot. Try Electrical for ${POLICY.evaluationDays} days, with no card and no automatic charge.`,
    });
  } else if (core.starter.month !== null) {
    offers.push({
      title: `ServiceClerk Starter — ${formatMoney(core.starter.month)}/month plus applicable tax`,
      body: "Unlimited jobs, quotes, contracts, deposits, progress invoices and payment collection, for any trade. The Electrical pack is on its way and isn't sold yet.",
    });
    offers.push({
      title: "Free — activate three jobs each month",
      body: "Finish and collect payment on those jobs without using another slot.",
    });
  }

  if (!offers.length) return null;

  return (
    <section className="mt-16 border-t pt-12">
      <h2 className="text-2xl font-semibold tracking-tight">What it costs</h2>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {offers.map((offer) => (
          <div key={offer.title} className="rounded-2xl border bg-card p-6 sm:p-8">
            <p className="font-medium">{offer.title}</p>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{offer.body}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-4 text-xs">
        {pricing.electricalAvailable ? "The Electrical pack requires Starter or Pro. " : ""}
        <Link href="/pricing" className="underline underline-offset-4">Core-only pricing and payment fees</Link>
      </p>
    </section>
  );
}
