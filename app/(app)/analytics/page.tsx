import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization } from "@/lib/dal";
import { getAccess } from "@/lib/membership/access";
import { agingBalances, collectedByMonth, quoteAcceptance } from "@/lib/queries/analytics";
import { formatMoney } from "@/lib/quote/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

/**
 * Business analytics — Pro (Billing §2.2): how many quotes turn into work,
 * what actually came in each month, and what's owed by how late it is.
 *
 * Kept off the dashboard on purpose: the dashboard is sentences about jobs
 * with a verb attached, and a stat-card homepage is its named anti-pattern.
 * This is the page for when the contractor sits down to look at the business.
 *
 * Below Pro the page says what it holds and shows none of it — no sample
 * numbers standing in for real ones.
 */
export default async function AnalyticsPage() {
  const org = await requireActiveOrganization();
  const access = await getAccess(org.id);

  if (!access.features.analytics) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <PageHeader title="Analytics" description="How the business is doing, from your own quotes, invoices and payments." />
        <div className="rounded-xl border p-5">
          <p className="font-medium">Analytics come with Pro</p>
          <ul className="text-muted-foreground mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm">
            <li>Quote acceptance — how many quotes you send turn into jobs</li>
            <li>Collected revenue — what came in each month, after refunds</li>
            <li>Aging balances — what&apos;s owed, by how late it is</li>
          </ul>
          <Button asChild className="mt-5">
            <Link href="/account/billing/plan">See Pro</Link>
          </Button>
        </div>
      </div>
    );
  }

  const [acceptance, months, aging] = await Promise.all([
    quoteAcceptance(org.id),
    collectedByMonth(org.id),
    agingBalances(org.id),
  ]);
  const owed = aging.reduce((sum, bucket) => sum + bucket.cents, 0);
  const late = aging.slice(1).reduce((sum, bucket) => sum + bucket.cents, 0);
  const collected90 = months.slice(-3).reduce((sum, month) => sum + month.cents, 0);
  const peak = Math.max(1, ...months.map((month) => month.cents));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
      <PageHeader title="Analytics" description="From your own quotes, invoices and payments. Demo work is left out." />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Quote acceptance, last 90 days"
          value={acceptance.rate === null ? "—" : `${Math.round(acceptance.rate * 100)}%`}
          note={acceptance.sent ? `${acceptance.accepted} of ${acceptance.sent} sent quotes accepted` : "No quotes sent in the last 90 days"}
        />
        <Stat
          label="Declined, last 90 days"
          value={String(acceptance.declined)}
          note={acceptance.sent ? `${acceptance.sent - acceptance.accepted - acceptance.declined} still open` : "Nothing sent yet"}
        />
        <Stat label="Collected, last 3 months" value={formatMoney(collected90)} note="Payments in, less refunds and chargebacks" />
        <Stat
          label="Owed to you"
          value={formatMoney(owed)}
          note={owed ? `${formatMoney(late)} of it is past due` : "Nothing outstanding"}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Collected each month</h2>
        {months.every((month) => month.cents === 0) ? (
          <p className="text-muted-foreground rounded-xl border p-5 text-sm">
            Nothing collected in the last six months yet. Payments your customers make — online or recorded by hand —
            show up here by the month they arrived.
          </p>
        ) : (
        <div className="rounded-xl border p-5">
          {/* One series, one hue. Each column carries its value on hover and
              focus; the table below says the same thing without the chart. */}
          <div className="flex h-48 items-end gap-3" role="img" aria-label="Collected revenue for each of the last six months">
            {months.map((month) => (
              <div key={month.month} className="group relative flex h-full flex-1 flex-col items-center justify-end" tabIndex={0}>
                <span className="bg-popover text-popover-foreground pointer-events-none absolute -top-1 z-10 -translate-y-full rounded-md border px-2 py-1 text-xs whitespace-nowrap opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus:opacity-100">
                  {month.label}: {formatMoney(month.cents)}
                </span>
                <div
                  className={cn("bg-primary w-full max-w-14 rounded-t-[4px]", month.cents === 0 && "bg-muted")}
                  style={{ height: `${Math.max(2, (Math.max(0, month.cents) / peak) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-3 border-t pt-2">
            {months.map((month) => (
              <span key={month.month} className="text-muted-foreground flex-1 text-center text-xs">
                {month.label}
              </span>
            ))}
          </div>
          <details className="mt-4">
            <summary className="text-muted-foreground cursor-pointer text-sm">Show as a table</summary>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {months.map((month) => (
                  <tr key={month.month} className="border-t">
                    <td className="py-1.5">{month.label} {month.month.slice(0, 4)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(month.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">What&apos;s owed, by how late</h2>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="px-5 py-3 font-medium">Age</th>
                <th className="px-5 py-3 text-right font-medium">Invoices</th>
                <th className="px-5 py-3 text-right font-medium">Owed</th>
              </tr>
            </thead>
            <tbody>
              {aging.map((bucket) => (
                <tr key={bucket.label} className="border-t">
                  <td className="px-5 py-2.5">{bucket.label}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{bucket.count}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(bucket.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {late ? (
          <p className="text-muted-foreground text-sm">
            <Link href="/invoices" className="text-primary-ink underline underline-offset-4">See the invoices</Link> to chase what&apos;s late.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border p-5">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs">{note}</p>
    </div>
  );
}
