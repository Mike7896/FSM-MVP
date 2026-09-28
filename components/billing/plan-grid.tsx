import { Check } from "lucide-react";

import { CheckoutButton } from "@/components/billing/checkout-button";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { formatMoney } from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * The plan catalogue, rendered once.
 *
 * Four surfaces show plans — Settings → Billing → Change plan, the in-app
 * Upgrade screen, its checkout, and the public pricing page. Four copies of a
 * price table is four chances for the marketing page to promise something the
 * billing page then contradicts, so there is one component and it reads the
 * same rows on all four.
 *
 * **Everything here comes from Stripe.** The name and the blurb are the
 * Product; the amount and the interval are the Price; what a plan includes is
 * `product.metadata.features`, one per line, because that is somewhere a human
 * can change a plan's description without a deploy — and because the alternative
 * is a hardcoded list that outlives the plan it describes.
 *
 * With no products seeded the grid says so rather than showing invented tiers.
 * A pricing page that quotes numbers the checkout does not honour is worse than
 * a pricing page that admits it is not ready.
 */

export type PlanRow = {
  price: {
    id: string;
    unitAmount: number | null;
    interval: string | null;
    currency: string;
  };
  product: {
    id: string;
    name: string;
    description: string | null;
    metadata: Record<string, string> | null;
  };
};

export function PlanGrid({
  plans,
  currentPriceId,
  organizationId,
  /** Where a signed-out reader goes instead of a checkout. */
  signUpHref,
}: {
  plans: PlanRow[];
  currentPriceId?: string | null;
  organizationId?: string;
  signUpHref?: string;
}) {
  if (plans.length === 0) {
    return (
      <Empty className="rounded-xl border">
        <EmptyHeader>
          <EmptyTitle>Plans aren&apos;t published yet</EmptyTitle>
          <EmptyDescription>
            Pricing is being finalised. Nothing is charged until it is, and
            everything you build in the meantime is yours to keep.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plans.map(({ price, product }) => {
        const current = currentPriceId === price.id;
        const features = featuresOf(product.metadata);

        return (
          <div
            key={price.id}
            className={cn(
              "flex flex-col rounded-xl border p-5",
              current && "border-primary/60 bg-primary/[0.03]"
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-semibold">{product.name}</h2>
              {current ? (
                <span className="text-primary-ink text-xs">Current</span>
              ) : null}
            </div>

            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {price.unitAmount === null ? "—" : formatMoney(price.unitAmount)}
              {price.interval ? (
                <span className="text-muted-foreground text-sm font-normal">
                  /{price.interval}
                </span>
              ) : null}
            </p>

            {product.description ? (
              <p className="text-muted-foreground mt-2 text-sm">
                {product.description}
              </p>
            ) : null}

            {features.length ? (
              <ul className="mt-4 flex flex-1 flex-col gap-1.5 text-sm">
                {features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex-1" />
            )}

            <div className="mt-5">
              {current ? (
                <Button disabled variant="outline" className="w-full">
                  Your plan
                </Button>
              ) : organizationId ? (
                <CheckoutButton
                  organizationId={organizationId}
                  priceId={price.id}
                >
                  Switch to {product.name}
                </CheckoutButton>
              ) : (
                <Button asChild className="w-full">
                  <a href={signUpHref ?? "/signup"}>Start with {product.name}</a>
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** `product.metadata.features`, one per line. */
function featuresOf(metadata: Record<string, string> | null): string[] {
  const raw = metadata?.features;
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
