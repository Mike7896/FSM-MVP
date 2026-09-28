import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatMoney } from "@/lib/quote";
import type { PackState } from "@/lib/queries/office";
import type { PaymentMethodSummary } from "@/lib/queries/billing";

/**
 * The bill, on the Account screen — wireframe 94 · 56b.
 *
 * **One membership, priced additively.** The core plan plus a monthly amount
 * per pack is a single charge with a visible breakdown, not separate
 * subscriptions, and the breakdown is what makes the total checkable rather
 * than merely stated.
 *
 * Compact on purpose: receipts, past-due handling and the pack-by-pack detail
 * live at `/account/billing`, and every row here that has more behind it says
 * so. What a *customer* pays the contractor with is not on this screen at all —
 * that is a rail, and rails are connections in the Office. No destination in
 * the product is named after a vendor.
 */
export function BillingSummary({
  planName,
  planCents,
  packs,
  totalCents,
  nextChargeOn,
  card,
  receiptCount,
  cancelling,
}: {
  planName: string | null;
  planCents: number | null;
  packs: PackState[];
  totalCents: number | null;
  nextChargeOn: Date | null;
  card: PaymentMethodSummary | null;
  receiptCount: number;
  cancelling: boolean;
}) {
  if (totalCents === null) {
    return (
      <div className="rounded-xl border p-5">
        <p className="font-medium">You&apos;re not on a paid plan</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Quotes, deposits, draws, invoices and collections all work without one.
          A plan lifts the send limit and adds your trade&apos;s pack.
        </p>
        <Button asChild className="mt-4">
          <Link href="/account/billing">See the plans</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-5">
      <div className="flex flex-col gap-1.5 text-sm">
        {planCents !== null ? (
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-2">
              {planName ?? "Plan"}
            </span>
            <span className="tabular-nums">{formatMoney(planCents)}</span>
          </div>
        ) : null}

        {packs.map((state) => (
          <div
            key={state.pack.id}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="text-muted-foreground">
              {state.pack.name} pack
              {state.enabled ? "" : " · switched off"}
            </span>
            <span className="tabular-nums">
              {state.priceCents === null ? "—" : formatMoney(state.priceCents)}
            </span>
          </div>
        ))}
      </div>

      <Separator className="my-4" />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {formatMoney(totalCents)}
          <span className="text-muted-foreground text-sm font-normal">/mo</span>
        </span>
        <span className="text-muted-foreground text-sm">
          {cancelling ? "ends" : "next charge"}{" "}
          {nextChargeOn ? formatDate(nextChargeOn) : "—"}
        </span>
      </div>

      {card?.last4 ? (
        <p className="text-muted-foreground mt-3 text-sm">
          {card.brand ? titleCase(card.brand) : "Card"} ending {card.last4}
          {card.expMonth && card.expYear
            ? ` · expires ${String(card.expMonth).padStart(2, "0")}/${String(
                card.expYear
              ).slice(-2)}`
            : ""}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <Link
          href="/account/billing"
          className="text-primary-ink underline underline-offset-4"
        >
          {receiptCount ? `Receipts · all ${receiptCount}` : "Billing detail"}
        </Link>
        <Link
          href="/account/billing/plan"
          className="text-primary-ink underline underline-offset-4"
        >
          Change plan
        </Link>
        {cancelling ? null : (
          <Link
            href="/account/billing/cancel"
            className="text-muted-foreground underline underline-offset-4"
          >
            Cancel subscription
          </Link>
        )}
      </div>

      {cancelling && nextChargeOn ? (
        <p className="mt-3">
          <Badge variant="secondary">
            Ends {formatDate(nextChargeOn)} — nothing changes until then
          </Badge>
        </p>
      ) : null}
    </div>
  );
}

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
