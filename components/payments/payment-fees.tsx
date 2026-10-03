import { CreditCard, Landmark } from "lucide-react";

import { bankFee, cardFee, feeRates } from "@/lib/payments/fees";
import { formatMoney } from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * What online payments cost the contractor, side by side — card and bank.
 *
 * With an `amountCents` it's the cost of *this* payment ("If Dave pays by
 * card: $54.68"); without one it's the rates, with a worked example so the
 * percentage means something. Either way it ends on the two facts that matter:
 * the customer pays the invoice amount, and the fee comes out of what lands.
 */
export function PaymentFees({
  amountCents,
  oursOn,
  payer,
  className,
}: {
  /** A specific payment to cost out. Left out, the rates are shown. */
  amountCents?: number;
  /** Whether ServiceClerk's bank-payment fee is switched on. */
  oursOn: boolean;
  /** "Dave" — who'd be paying, for the sentence. */
  payer?: string;
  className?: string;
}) {
  const rates = feeRates(oursOn);
  const example = amountCents ?? 100_000;
  const card = cardFee(example);
  const bank = bankFee(example, oursOn);
  const saving = card.totalCents - bank.totalCents;

  return (
    <div className={cn("rounded-lg border", className)}>
      <div className="border-b px-4 py-3">
        <p className="text-sm font-semibold">
          {amountCents !== undefined
            ? `What it costs you if ${payer ?? "they"} pay${payer ? "s" : ""} online`
            : "What online payments cost you"}
        </p>
        <p className="text-muted-foreground mt-0.5 text-[13px] leading-snug">
          {amountCents !== undefined
            ? `${payer ?? "Your customer"} pays ${formatMoney(amountCents)} either way. The fee comes out before the money reaches your bank.`
            : "Your customer always pays the invoice amount. The fee comes out before the money reaches your bank."}
        </p>
      </div>

      <dl className="divide-y">
        <FeeRow
          icon={<CreditCard className="size-4" />}
          method="Card"
          rate={`${rates.card}, charged by Stripe`}
          cents={card.totalCents}
          amountLabel={amountCents !== undefined ? null : formatMoney(example)}
        />
        <FeeRow
          icon={<Landmark className="size-4" />}
          method="Bank transfer"
          rate={`${rates.bank}${oursOn ? "" : ", charged by Stripe"}. Clears in a few business days.`}
          cents={bank.totalCents}
          amountLabel={amountCents !== undefined ? null : formatMoney(example)}
          cheaper={saving > 0}
        />
      </dl>

      {saving > 0 ? (
        <p className="text-muted-foreground border-t px-4 py-2.5 text-[13px] leading-snug">
          A bank transfer saves you{" "}
          <span className="text-positive font-medium">
            {formatMoney(saving, { forceCents: true })}
          </span>
          {amountCents !== undefined ? " on this invoice" : ` on ${formatMoney(example)}`}
          . The bigger the bill, the bigger the difference.
        </p>
      ) : null}
    </div>
  );
}

function FeeRow({
  icon,
  method,
  rate,
  cents,
  amountLabel,
  cheaper = false,
}: {
  icon: React.ReactNode;
  method: string;
  rate: string;
  cents: number;
  /** "$1,000.00" when this is a worked example rather than a real payment. */
  amountLabel: string | null;
  cheaper?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 gap-2.5">
        <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0">
          <dt className="text-sm font-medium">{method}</dt>
          <dd className="text-muted-foreground text-[13px] leading-snug">{rate}</dd>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={cn(
            "text-sm font-semibold tabular-nums",
            cheaper && "text-positive"
          )}
        >
          {formatMoney(cents, { forceCents: true })}
        </p>
        <p className="text-muted-foreground text-xs">
          {amountLabel ? `on ${amountLabel}` : "fee"}
        </p>
      </div>
    </div>
  );
}
