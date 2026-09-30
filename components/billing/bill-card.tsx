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
    return (
      <div className="rounded-2xl border bg-card p-6 sm:p-8">
        <p className="font-medium">
          {access.standing === "comp" ? "Complimentary Pro" : "You're on Free"}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {access.standing === "comp"
            ? "You won't be charged for ServiceClerk."
            : "Three new jobs a month, each one finished and paid for without using another. A plan lifts the limit."}
        </p>
        {access.standing === "comp" ? null : (
          <Button asChild className="mt-4">
            <Link href="/account/billing/plan">See the plans</Link>
          </Button>
        )}
      </div>
    );
  }

  const renews = access.currentPeriodEnd;
  const per = bill.interval === "year" ? "/yr" : "/mo";

  return (
    <div className="rounded-2xl border bg-card p-6 sm:p-8">
      <p className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wider">Membership total</p>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {bill.totalCents === null ? "—" : formatMoney(bill.totalCents)}
          <span className="text-muted-foreground text-sm font-normal">{per}</span>
          <span className="text-muted-foreground mt-2 block text-xs font-normal">Plus applicable tax</span>
        </span>
        <span className="text-muted-foreground text-sm">
          {access.cancelAtPeriodEnd ? "ends" : "renews"} {renews ? dateOf(renews) : "—"}
        </span>
      </div>

      <Separator className="my-6" />
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
              ? `, ${formatMoney(nextBill.totalCents)}${nextBill.interval === "year" ? "/yr" : "/mo"} plus applicable tax`
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

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
