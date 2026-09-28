import Link from "next/link";
import type { Metadata } from "next";

import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { eq } from "drizzle-orm";

import { requireActiveOrganization, requireSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { accountPolicies } from "@/lib/db/schema";
import { formatMoney } from "@/lib/quote";
import {
  getDefaultPaymentMethod,
  getSubscription,
  listReceipts,
} from "@/lib/queries/billing";
import { listPacks } from "@/lib/queries/office";

export const metadata: Metadata = { title: "Billing" };

/**
 * Screen 33 · billing · Flow 12, job PS4.
 *
 * The correct emotion here is **indifference**. Everywhere else in the product
 * money moves from a homeowner to the contractor and the app is the
 * contractor's advocate; this is the one surface where it moves from the
 * contractor to us, and it must not stop being their advocate the moment it
 * starts charging them.
 *
 * That means: no retention dark patterns, cancel is easy to find, and a lapsed
 * card gets a grace period with plain language rather than features silently
 * vanishing.
 *
 * **Everything on this page is what Stripe says.** The plan and its price come
 * from the read-model the webhook maintains; the receipts and the card come
 * from Stripe directly, because a mirrored last-four that has gone stale tells
 * a contractor a charge will land on a card they replaced.
 */
export default async function BillingPage() {
  const [org, session] = await Promise.all([requireActiveOrganization(), requireSession()]);
  // Set from the admin panel for testers and friends: treated as paying.
  const [policy] = await db
    .select({ compPlan: accountPolicies.compPlan, kind: accountPolicies.kind, accessUntil: accountPolicies.accessUntil })
    .from(accountPolicies)
    .where(eq(accountPolicies.userId, session.userId))
    .limit(1);

  const [subscription, packs, receipts, card] = await Promise.all([
    getSubscription(org.id),
    listPacks(org.id),
    listReceipts(org.id),
    getDefaultPaymentMethod(org.id),
  ]);

  const ownedPacks = packs.filter((state) => state.entitled);
  const planCents = subscription?.price?.unitAmount ?? null;
  const packCents = ownedPacks.reduce(
    (sum, state) => sum + (state.priceCents ?? 0),
    0
  );
  const totalCents = planCents === null ? null : planCents + packCents;

  const status = subscription?.subscription.status;
  const periodEnd = subscription?.subscription.currentPeriodEnd ?? null;
  const cancelling = subscription?.subscription.cancelAtPeriodEnd ?? false;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Billing"
        description="What you're paying, and why."
        actions={<ManageBillingButton organizationId={org.id} />}
      />

      {policy?.compPlan ? (
        <Alert>
          <AlertTitle>Your account is complimentary</AlertTitle>
          <AlertDescription>
            You won&apos;t be charged for ServiceClerk
            {policy.kind === "tester" && policy.accessUntil
              ? ` while you're trying it out — through ${new Date(`${policy.accessUntil}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
              : ""}
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {/* A lapsed card is stated plainly, with the grace period named, rather
          than features quietly switching off. */}
      {status === "past_due" ? (
        <Alert variant="destructive">
          <AlertTitle>Your last payment didn&apos;t go through</AlertTitle>
          <AlertDescription>
            Everything keeps working while we retry. Update the card and it
            settles itself — nothing you&apos;ve sent is affected either way.
          </AlertDescription>
        </Alert>
      ) : null}

      {cancelling && periodEnd ? (
        <Alert>
          <AlertTitle>Your subscription ends {formatDate(periodEnd)}</AlertTitle>
          <AlertDescription>
            Until then nothing changes. After it, your data stays exportable and
            every share link you&apos;ve sent stays live — your customers&apos;
            experience doesn&apos;t break because of a change to your plan.
          </AlertDescription>
        </Alert>
      ) : null}

      {subscription ? (
        <div className="rounded-xl border p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <h2 className="font-medium">
                {subscription.product?.name ?? "Your plan"}
              </h2>
              {status === "trialing" ? (
                <Badge variant="secondary">Trial</Badge>
              ) : null}
            </div>
            <Link
              href="/account/billing/plan"
              className="text-primary-ink text-sm underline underline-offset-4"
            >
              Change plan
            </Link>
          </div>

          <div className="mt-4 flex flex-col gap-1.5 text-sm">
            {planCents !== null ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {subscription.product?.name ?? "Plan"}
                </span>
                <span className="tabular-nums">
                  {formatMoney(planCents)}/mo
                </span>
              </div>
            ) : null}
            {ownedPacks.map((state) => (
              <div key={state.pack.id} className="flex justify-between">
                <span className="text-muted-foreground">
                  {state.pack.name} pack
                  {state.enabled ? "" : " · switched off"}
                </span>
                <span className="tabular-nums">
                  {state.priceCents === null
                    ? "—"
                    : `${formatMoney(state.priceCents)}/mo`}
                </span>
              </div>
            ))}
          </div>

          <Separator className="my-4" />

          <div className="flex items-baseline justify-between">
            <span className="font-label text-[11px] uppercase">
              {cancelling ? "Ends" : "Next charge"}
            </span>
            <span className="text-2xl font-semibold tabular-nums">
              {totalCents === null ? "—" : formatMoney(totalCents)}
              <span className="text-muted-foreground text-sm font-normal">
                /mo
              </span>
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {[
              periodEnd ? formatDate(periodEnd) : null,
              card?.last4
                ? `${card.brand ? titleCase(card.brand) : "Card"} ending ${card.last4}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Managed in the billing portal."}
          </p>
        </div>
      ) : (
        <Empty className="rounded-xl border">
          <EmptyHeader>
            <EmptyTitle>You&apos;re not on a paid plan</EmptyTitle>
            <EmptyDescription>
              Quotes, deposits, draws, invoices and collections all work without
              one. A plan lifts the send limit and adds your trade&apos;s pack.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/account/billing/plan">See the plans</Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {receipts.length ? (
        <section className="rounded-xl border p-5">
          <p className="text-muted-foreground font-label text-[11px] uppercase">
            Receipts
          </p>
          <div className="mt-3 flex flex-col">
            {receipts.map((receipt, index) => (
              <div
                key={receipt.id}
                className={`flex items-center justify-between py-2.5 text-sm ${index ? "border-t" : ""}`}
              >
                <span>{formatDate(new Date(receipt.created * 1000))}</span>
                <div className="flex items-center gap-4">
                  <span className="text-muted-foreground tabular-nums">
                    {formatMoney(receipt.amountPaidCents)}
                  </span>
                  {receipt.pdfUrl ? (
                    <a
                      href={receipt.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary-ink underline underline-offset-4"
                    >
                      PDF
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
        <p className="text-muted-foreground text-sm">
          Leaving? Export everything first — it stays available either way.
        </p>
        {subscription && !cancelling ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/account/billing/cancel">Cancel subscription</Link>
          </Button>
        ) : null}
      </div>
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
