import Link from "next/link";
import { Check, Minus } from "lucide-react";

import type { PickerPricing } from "@/components/billing/plan-picker";
import { Button } from "@/components/ui/button";
import {
  TIER_LABEL,
  comparisonGroups,
  type ComparisonCell,
  type Tier,
} from "@/lib/membership/catalog";
import { formatMoney } from "@/lib/quote/money";
import { cn } from "@/lib/utils";

/**
 * Compare plans — the entitlement matrix, row by row (Billing §2.2).
 *
 * Every row comes from `comparisonGroups`, which reads the same limits the
 * app enforces, so what the table promises is what the product does. Only
 * plans that are on sale get a column, and the Electrical row appears only
 * while the pack is sold — the page never lists something a shop can't buy.
 *
 * A dash is "not on this plan", never "unknown"; each mark carries its words
 * for screen readers, and nothing is said by colour alone.
 */
export function PlanComparison({
  pricing,
  signUpHref,
}: {
  pricing: PickerPricing;
  signUpHref: string;
}) {
  const tiers: Tier[] = pricing.proAvailable ? ["free", "starter", "pro"] : ["free", "starter"];
  const pack = pricing.packs.electrical.month;
  // A row no plan on sale includes isn't a feature anyone can buy yet, so it
  // isn't listed — Pro's rows appear with Pro.
  const groups = comparisonGroups({
    electricalAddOn: pricing.electricalAvailable && pack !== null ? `+${formatMoney(pack)}/mo` : null,
  })
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => tiers.some((tier) => row.values[tier] !== false)),
    }))
    .filter((group) => group.rows.length > 0);

  const price = (tier: Tier) => {
    if (tier === "free") return "$0";
    const cents = pricing.core[tier].month;
    return cents === null ? "—" : `${formatMoney(cents)}/mo`;
  };

  return (
    <div className="w-full overflow-x-auto rounded-2xl border bg-card p-4 sm:p-6">
      <table className="w-full min-w-[480px] table-fixed border-separate border-spacing-0 text-sm">
        <caption className="sr-only">What each plan includes</caption>
        <colgroup>
          <col className="w-[40%] sm:w-[46%]" />
          {tiers.map((tier) => (
            <col key={tier} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="bg-background md:sticky md:top-18 z-10 border-b py-3 text-left align-bottom">
              <span className="sr-only">Feature</span>
            </th>
            {tiers.map((tier) => (
              <th
                key={tier}
                scope="col"
                className="bg-background md:sticky md:top-18 z-10 border-b px-1 py-3 text-center align-bottom sm:px-3"
              >
                <span className="block font-semibold">{TIER_LABEL[tier]}</span>
                <span className="text-muted-foreground block text-xs font-normal tabular-nums">{price(tier)}</span>
              </th>
            ))}
          </tr>
        </thead>

        {groups.map((group) => (
          <tbody key={group.title}>
            <tr>
              <th
                scope="colgroup"
                colSpan={tiers.length + 1}
                className="font-label text-muted-foreground border-b pt-8 pb-2 text-left text-[11px] font-normal uppercase"
              >
                {group.title}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="border-b py-4 pr-3 text-left align-top font-normal">
                  <span className="block">{row.label}</span>
                  {row.detail ? (
                    <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">{row.detail}</span>
                  ) : null}
                </th>
                {tiers.map((tier) => (
                  <td key={tier} className="border-b px-1 py-4 text-center align-top sm:px-3">
                    <Cell value={row.values[tier]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}

        <tfoot>
          <tr>
            <td className="pt-5" />
            {tiers.map((tier) => (
              <td key={tier} className="px-1 pt-5 text-center sm:px-3">
                <Button
                  asChild
                  size="sm"
                  variant={tier === "free" ? "outline" : "default"}
                  className="w-full whitespace-normal"
                >
                  <Link href={tier === "free" ? signUpHref : `${signUpHref}?plan=${tier}`}>
                    {tier === "free" ? "Start free" : `Start ${TIER_LABEL[tier]}`}
                  </Link>
                </Button>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>

      <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
        Prices exclude applicable tax. Annual plans cost the equivalent of ten monthly payments, billed once a year.
      </p>
    </div>
  );
}

function Cell({ value }: { value: ComparisonCell }) {
  if (value === true) {
    return (
      <span className="inline-flex justify-center">
        <Check className="size-4" aria-hidden />
        <span className="sr-only">Included</span>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="text-muted-foreground/60 inline-flex justify-center">
        <Minus className="size-4" aria-hidden />
        <span className="sr-only">Not included</span>
      </span>
    );
  }
  return <span className={cn("text-xs leading-snug sm:text-sm")}>{value}</span>;
}
