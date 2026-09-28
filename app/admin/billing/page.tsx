import type { Metadata } from "next";

import { ReleaseSwitches } from "@/components/admin/release-switches";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/admin/access";
import { RELEASE_KEYS, RELEASES, TIER_LABEL } from "@/lib/membership/catalog";
import {
  billingReadiness,
  foundingSeats,
  membershipCounts,
  recentBillingEvents,
} from "@/lib/membership/readiness";
import { getReleases } from "@/lib/membership/releases";

export const metadata: Metadata = { title: "Billing" };

/**
 * The membership, from our side — Billing §14.
 *
 * What's on sale, whether the launch gates are actually met, how many
 * founding seats are gone, and the recent billing log. The gates are read
 * from Stripe and the environment; the ones only a person can decide say so.
 */
export default async function AdminBillingPage() {
  const admin = await requireAdmin();
  const [releases, gates, seats, counts, events] = await Promise.all([
    getReleases(),
    billingReadiness(),
    foundingSeats(),
    membershipCounts(),
    recentBillingEvents(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-8 md:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground mt-1 text-sm">What&apos;s on sale, whether it&apos;s ready to be, and what changed.</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-label text-[11px] uppercase">On sale</h2>
        <ReleaseSwitches
          owner={admin.owner}
          launchedAt={releases.foundingLaunchAt}
          releases={RELEASE_KEYS.map((key) => ({
            key,
            label: RELEASES[key].label,
            detail: RELEASES[key].detail,
            enabled: releases[key],
          }))}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-label text-[11px] uppercase">Launch gates (§14.2)</h2>
        <div className="rounded-xl border">
          {gates.map((gate, index) => (
            <div key={gate.label} className={`flex items-start gap-4 px-5 py-3 ${index ? "border-t" : ""}`}>
              <Badge variant={gate.state === "ok" ? "secondary" : gate.state === "open" ? "destructive" : "outline"} className="w-16 shrink-0 justify-center">
                {gate.state === "ok" ? "Ready" : gate.state === "open" ? "Not yet" : "Decide"}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm font-medium">{gate.label}</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{gate.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border p-5">
          <p className="text-muted-foreground text-sm">Founding seats</p>
          <p className="mt-2 text-3xl font-semibold">
            {seats.enrolled}
            <span className="text-muted-foreground text-base font-normal"> of {seats.cap}</span>
          </p>
          <p className="text-muted-foreground mt-1 text-xs">{seats.held} held by an open checkout</p>
        </div>
        <div className="rounded-xl border p-5">
          <p className="text-muted-foreground text-sm">Memberships</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {counts.length ? (
              counts.map((row) => (
                <li key={`${row.tier}-${row.status}`} className="flex justify-between gap-4">
                  <span>
                    {TIER_LABEL[row.tier]} · {row.status ?? "no subscription"}
                  </span>
                  <span className="tabular-nums">{row.n}</span>
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">None yet.</li>
            )}
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-label text-[11px] uppercase">Billing log</h2>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <tbody>
              {events.length ? (
                events.map((event) => (
                  <tr key={event.id} className="border-t first:border-t-0 align-top">
                    <td className="text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">
                      {event.occurredAt.toISOString().replace("T", " ").slice(0, 16)}
                    </td>
                    <td className="px-4 py-2 font-medium whitespace-nowrap">{event.kind}</td>
                    <td className="text-muted-foreground px-4 py-2 text-xs">
                      <code className="break-all">{JSON.stringify(event.detail ?? {})}</code>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="text-muted-foreground px-4 py-3">Nothing yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
