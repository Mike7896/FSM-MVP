import Link from "next/link";

import { MembershipAction } from "@/components/billing/membership-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Bill } from "@/lib/membership/bill";
import { PACK_LABEL, TIER_LABEL, type PackId } from "@/lib/membership/catalog";
import type { BillingOverview } from "@/lib/membership/overview";
import { formatMoney } from "@/lib/quote/money";

/**
 * The bill — Billing §2.1, §5.2, §12. **One membership, priced additively**:
 * the core plan and each pack as lines, the total under them, and the date it
 * next renews. A change waiting for the renewal is stated beside the bill it
 * will change, with the way to take it back.
 */
export function BillCard({
  overview,
  organizationId,
  compact = false,
}: {
  overview: BillingOverview;
  organizationId: string;
  compact?: boolean;
}) {
  const { access, bill, nextBill, card } = overview;

  if (!bill) {
    const comp = access.standing === "comp" ? access.comp : null;
    // A free period with an end: say when, and let them choose what comes
    // after now — checkout turns the rest of it into a trial.
    const freeEnds = comp?.endsAt ?? null;
    return (
      <div className="rounded-2xl border bg-card p-6 sm:p-8">
        <p className="font-medium">
          {freeEnds ? `Free Pro through ${dayOf(lastDayBefore(freeEnds))}` : comp ? "Complimentary Pro" : "You're on Free"}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {freeEnds
            ? `Choose the plan you'll keep after that — nothing is charged until ${dayOf(freeEnds)}. Or don't, and you'll move to Free; everything you've made stays.`
            : comp
              ? "You won't be charged for ServiceClerk."
              : "Three new jobs a month, each one finished and paid for without using another. A plan lifts the limit."}
        </p>
        {comp && !freeEnds ? null : (
          <Button asChild className="mt-4">
            <Link href="/account/billing/plan">{freeEnds ? "Choose your plan" : "See the plans"}</Link>
          </Button>
        )}
      </div>
    );
  }

  const renews = access.currentPeriodEnd;
  const trialEnds = access.trialEndsAt;
  const per = bill.interval === "year" ? "/yr" : "/mo";

  return (
    <div className="rounded-2xl border bg-card p-6 sm:p-8">
      <p className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wider">
        {bill.upcoming ? "Next invoice estimate" : "Plan subtotal before discounts and tax"}
      </p>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {bill.upcoming
            ? new Intl.NumberFormat("en-US", { style: "currency", currency: bill.upcoming.currency }).format(bill.upcoming.amountDueCents / 100)
            : bill.totalCents === null ? "—" : formatMoney(bill.totalCents)}
          {bill.upcoming ? null : <span className="text-muted-foreground text-sm font-normal">{per}</span>}
          <span className="text-muted-foreground mt-2 block text-xs font-normal">
            {bill.upcoming
              ? "Includes discounts, credits and estimated tax. The final invoice may change."
              : access.cancelAtPeriodEnd ? "Your membership is set to end." : "Next invoice estimate unavailable. See Card and invoices for your bills."}
          </span>
        </span>
        <span className="text-muted-foreground text-sm">
          {trialEnds && !access.cancelAtPeriodEnd
            ? `first charge ${dayOf(trialEnds)}`
            : `${access.cancelAtPeriodEnd ? "ends" : "renews"} ${renews ? dateOf(renews) : "—"}`}
        </span>
      </div>

      {trialEnds ? (
        <p className="bg-muted/50 mt-4 rounded-lg p-3 text-sm">
          Free through {dayOf(lastDayBefore(trialEnds))}. Your card isn&apos;t charged before {dayOf(trialEnds)}, and you can
          change or cancel the plan until then.
        </p>
      ) : null}

      <Separator className="my-6" />
      <p className="text-muted-foreground mb-3 text-xs">Plan prices before discounts and tax</p>
      <Lines bill={bill} />

      {card?.last4 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {card.brand ? titleCase(card.brand) : "Card"} ending {card.last4}
          {card.expMonth && card.expYear
            ? ` · expires ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`
            : ""}
        </p>
      ) : null}

      {access.founding.price ? (
        <p className="mt-3">
          <Badge variant="secondary">Founding member — founding core pricing while your membership stays active</Badge>
        </p>
      ) : null}

      {access.cancelAtPeriodEnd && renews ? (
        <div className="bg-muted/50 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3 text-sm">
          <span>
            Your membership ends {dateOf(renews)}, packs and all. Nothing changes until then, and you won&apos;t be charged again.
          </span>
          <MembershipAction
            endpoint="/api/v1/membership/resume"
            label="Keep my membership"
            success="Your membership carries on. Nothing new was charged."
          />
        </div>
      ) : null}

      {!access.cancelAtPeriodEnd && access.scheduled && nextBill ? (
        <div className="bg-muted/50 mt-4 flex flex-col gap-3 rounded-lg p-3 text-sm">
          <p>
            On {dateOf(new Date(access.scheduled.effectiveAt))} this becomes{" "}
            <strong className="font-medium">
              {describe(access.scheduled.tier!, access.scheduled.packs as PackId[])}
            </strong>
            {nextBill.totalCents !== null
              ? `, ${formatMoney(nextBill.totalCents)}${nextBill.interval === "year" ? "/yr" : "/mo"} before discounts and tax`
              : ""}
            . You keep what you have until then.
          </p>
          <div>
            <MembershipAction
              endpoint="/api/v1/membership/keep-plan"
              label="Keep my current plan instead"
              success="Nothing will change at your renewal."
            />
          </div>
        </div>
      ) : null}

      {compact ? null : (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button asChild size="sm">
            <Link href="/account/billing/plan">Change plan</Link>
          </Button>
          <MembershipAction
            endpoint="/api/stripe/portal"
            label="Card and invoices"
            body={{ organizationId }}
            redirectToUrl
          />
        </div>
      )}
    </div>
  );
}

function Lines({ bill }: { bill: Bill }) {
  const per = bill.interval === "year" ? "/yr" : "/mo";
  return (
    <div className="flex flex-col gap-3 text-sm">
      {bill.lines.map((line) => (
        <div key={line.label} className="flex items-baseline justify-between gap-3">
          <span className={line.kind === "core" ? "" : "text-muted-foreground"}>{line.label}</span>
          <span className="tabular-nums">{line.cents === null ? "—" : `${formatMoney(line.cents)}${per}`}</span>
        </div>
      ))}
    </div>
  );
}

function describe(tier: "starter" | "pro", packs: PackId[]) {
  return [TIER_LABEL[tier], ...packs.map((pack) => `${PACK_LABEL[pack]} pack`)].join(" + ");
}

export function dateOf(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * A free period's dates are whole UTC days (it runs through its last day,
 * and the first charge is midnight UTC after it), so they're named in UTC —
 * never a day early on a server or browser west of Greenwich.
 */
function dayOf(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The last free day, for an end at midnight after it. */
function lastDayBefore(end: Date) {
  return new Date(end.getTime() - 1);
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
