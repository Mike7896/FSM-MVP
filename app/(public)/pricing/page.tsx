import type { Metadata } from "next";

import { PlanComparison } from "@/components/billing/plan-comparison";
import { PlanPicker } from "@/components/billing/plan-picker";
import { POLICY, TIER_FEATURES } from "@/lib/membership/catalog";
import { pickerPricing } from "@/lib/membership/bill";

export const metadata: Metadata = { title: "Pricing" };

/**
 * Cached, but never for long: prices and what's on sale come from Stripe and
 * the release switches, which change without a deploy. Five minutes at most,
 * and switching a release refreshes it at once.
 */
export const revalidate = 300;

/**
 * Screen 48 · the pricing page · class B·W, Flow 17 · Billing §2, §8.2, §12.
 *
 * Serves someone **comparison-shopping before signup**: all tiers, the
 * annual saving, the pack's real total, and what payments cost. The in-app
 * `/upgrade` picker is the other half — the same `PlanPicker` reading the
 * same Stripe prices, so the marketing page cannot promise a number the
 * checkout then refuses.
 *
 * Rules it holds:
 * - **Totals, not teasers.** With the Electrical pack ticked, every card is
 *   what an electrician actually pays. The pack is never pre-ticked.
 * - **Free is capped, never crippled** — three activated jobs a month, each
 *   finished and paid for without using another.
 * - **Fees said separately**, never folded into a promised "all-in" rate.
 * - **Only what ships is sold.** Pro and the pack appear when their release
 *   switches are on; until then the page offers what exists.
 */
export default async function PricingPage() {
  const pricing = await pickerPricing(null);
  const free = TIER_FEATURES.free;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-label mb-5 text-xs font-medium uppercase tracking-widest text-primary-ink">Simple plans for a working shop</p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Less paperwork.
          More room to grow.
        </h1>
        <p className="text-muted-foreground mx-auto mt-6 max-w-xl text-base leading-relaxed sm:text-lg">
          Start with three free jobs a month. Move to unlimited jobs when you need them. Every plan takes you from the first quote to the final payment.
        </p>
      </div>

      <div className="mt-10 sm:mt-14">
        <PlanPicker pricing={pricing} mode={{ kind: "public", signUpHref: "/signup" }} showFree />
      </div>

      <section className="mt-20 border-t pt-12 sm:mt-24">
        <h2 className="text-2xl font-semibold tracking-tight">Compare plans</h2>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Every plan runs the whole money side of the job. What changes is how many new jobs you start each month, and
          what you get on top.
        </p>
        <div className="mt-6">
          <PlanComparison pricing={pricing} signUpHref="/signup" />
        </div>
      </section>

      <section className="mt-20 grid gap-12 border-t pt-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Getting paid by your customers</h2>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Your customer pays the invoice amount — nothing is added to their bill. Fees come out of what you
            receive, and they&apos;re the same on every plan.
          </p>
          <dl className="mt-5 flex flex-col text-sm">
            {[
              ["Card", "Your Stripe processing rate. No ServiceClerk fee."],
              ["ACH bank payment", "Your Stripe processing rate, plus a ServiceClerk fee of 0.2%, capped at $5 per successful payment."],
              ["Cash, check or transfer you record", "No fee from us or from Stripe."],
            ].map(([rail, fee], index) => (
              <div key={rail} className={`flex flex-col gap-1 py-3 sm:flex-row sm:gap-6 ${index ? "border-t" : ""}`}>
                <dt className="w-44 shrink-0 font-medium">{rail}</dt>
                <dd className="text-muted-foreground">{fee}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
            Additional Stripe charges may apply for things like account verification or a returned bank payment.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Frequently asked questions</h2>
          <div className="mt-5 flex flex-col gap-6">
            {[
              {
                q: "What counts as a job on Free?",
                a: `A job counts the first time something goes out on it — a quote, contract, change order or invoice is sent, a customer-ready PDF is made, or online payment is initiated. After that, revisions, deposits, progress bills and the final invoice on that job are free. You get ${free.monthlyActivations} new jobs each calendar month, and drafts never count.`,
              },
              ...(pricing.electricalAvailable
                ? [{
                    q: "Can I try the Electrical pack first?",
                    a: `Yes — ${POLICY.evaluationDays} days, once per business, with no card and no automatic charge. When it ends, anything you wrote with it stays exactly as it is.`,
                  }]
                : []),
              {
                q: "What happens if I downgrade or cancel?",
                a: "You keep what you paid for until the end of the period, then the change takes effect. Your jobs, documents and payment history stay, every link you've sent keeps working, and you can finish and collect on existing jobs.",
              },
              {
                q: "Is there a refund?",
                a: `Within ${POLICY.refundWindowDays} days of your first paid purchase you can have it back and return to Free, once. After that, cancelling stops the next renewal.`,
              },
              {
                q: "Does my customer need an account?",
                a: "Never. Everything you send opens from a link on their phone — review, approve, sign and pay.",
              },
            ].map((item) => (
              <div key={item.q}>
                <h3 className="font-medium">{item.q}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
