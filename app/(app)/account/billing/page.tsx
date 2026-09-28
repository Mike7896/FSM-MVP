import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { BillCard, dateOf } from "@/components/billing/bill-card";
import { MembershipAction } from "@/components/billing/membership-action";
import { UsageCard } from "@/components/billing/usage-card";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization } from "@/lib/dal";
import { PACK_LABEL, POLICY } from "@/lib/membership/catalog";
import { getBillingOverview } from "@/lib/membership/overview";
import { reconcileCheckoutSession } from "@/lib/membership/reconcile";
import { safeNextPath } from "@/lib/safe-next";
import { formatMoney } from "@/lib/quote/money";

export const metadata: Metadata = { title: "Billing" };

/**
 * Screen 33 · billing · Flow 12, job PS4 · Billing §5.
 *
 * The correct emotion here is **indifference**. Everywhere else money moves
 * from a homeowner to the contractor and the app is the contractor's
 * advocate; this is the one surface where it moves to us, and it must not stop
 * being their advocate the moment it starts charging them. No retention dark
 * patterns, cancel is easy to find, a lapsed card gets its grace period in
 * plain words, and the 14-day refund is a button, not a request.
 *
 * **Coming back from Checkout unlocks nothing by itself.** The page asks
 * Stripe what the session produced and reconciles that (§11.2); until the
 * payment is confirmed it says so.
 */
export default async function BillingPage({ searchParams }: PageProps<"/account/billing">) {
  const org = await requireActiveOrganization();
  const params = await searchParams;
  const sessionId = typeof params.session_id === "string" ? params.session_id : null;
  const next = typeof params.next === "string" ? safeNextPath(params.next, "") : "";

  if (params.checkout === "success" && sessionId) {
    await reconcileCheckoutSession(sessionId, org.id).catch((error) =>
      console.error("[billing] couldn't reconcile the checkout session:", error)
    );
    // Render again from the reconciled state — the whole page, the app
    // shell's bill included, reads it fresh — and drop the session id.
    redirect(`/account/billing?checkout=confirmed${next ? `&next=${encodeURIComponent(next)}` : ""}`);
  }
  const returning = params.checkout === "confirmed";

  const overview = await getBillingOverview(org.id);
  const { access, receipts } = overview;
  const electrical = access.packs.electrical;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 sm:gap-10">
      <PageHeader title="Billing" description="What you're paying ServiceClerk, and why." />

      {returning ? (
        access.standing === "paid" ? (
          <Alert>
            <AlertTitle>You&apos;re all set</AlertTitle>
            <AlertDescription>
              Your payment went through and your plan is active.
              {next ? (
                <>
                  {" "}
                  <Link href={next} className="underline underline-offset-4">Back to where you were</Link>
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertTitle>Confirming your payment</AlertTitle>
            <AlertDescription>
              Stripe hasn&apos;t confirmed it yet. Your plan starts the moment it does — refresh in a few seconds.
            </AlertDescription>
          </Alert>
        )
      ) : null}

      {access.standing === "grace" && access.graceEndsAt ? (
        <Alert variant="destructive">
          <AlertTitle>Your renewal didn&apos;t go through</AlertTitle>
          <AlertDescription>
            Everything keeps working until {dateOf(access.graceEndsAt)} while we retry. Update your card to settle it —
            nothing you&apos;ve sent is affected either way. New purchases wait until it&apos;s paid.
          </AlertDescription>
        </Alert>
      ) : null}

      {access.standing === "restricted" ? (
        <Alert variant="destructive">
          <AlertTitle>Paid features are paused</AlertTitle>
          <AlertDescription>
            Your renewal is still unpaid, so Free rules apply for now. Your jobs, documents and customer payments are all
            here. Update your card and everything comes straight back.
          </AlertDescription>
        </Alert>
      ) : null}

      {access.pending ? (
        <Alert>
          <AlertTitle>A change is waiting for its payment</AlertTitle>
          <AlertDescription>
            Nothing changed yet — you keep your current plan until the payment goes through. Finish it from{" "}
            <em>Card and invoices</em>, or let it lapse.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-label text-[11px] uppercase">Your plan</h2>
        <BillCard overview={overview} organizationId={org.id} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-label text-[11px] uppercase">This month</h2>
        <UsageCard usage={overview.usage} storage={overview.storage} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-label text-[11px] uppercase">Trade packs</h2>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-6 sm:p-8 text-sm">
          <p>
            <strong className="font-medium">{PACK_LABEL.electrical}</strong>{" "}
            {electrical.purchased
              ? electrical.endsAt
                ? `— on your plan until ${dateOf(electrical.endsAt)}.`
                : `— on your plan${electrical.enabled ? "" : ", hidden from your workspace"}.`
              : electrical.evaluation?.active
                ? `— evaluating until ${dateOf(electrical.evaluation.expiresAt)}. No card, no automatic charge.`
                : electrical.evaluationUsed
                  ? "— evaluation used."
                  : "— not on your plan."}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/office/packs/electrical">Manage</Link>
          </Button>
        </div>
      </section>

      {access.refund.eligible && access.refund.until && overview.bill ? (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-6 sm:p-8">
          <div>
            <p className="font-medium">Changed your mind?</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Until {dateOf(access.refund.until)} you can have your first payment back and return to Free. Once per
              business.
            </p>
          </div>
          <MembershipAction
            endpoint="/api/v1/membership/refund"
            label="Refund and return to Free"
            success="Refunded. You're back on Free, and everything you built is still here."
            confirm={{
              title: "Refund your first payment?",
              lines: [
                `Every membership payment from your first ${POLICY.refundWindowDays} days is refunded to your card — Stripe usually shows it within 5–10 days.`,
                "Your plan and any packs end now, and you're back on Free straight away.",
                "Your jobs, documents and customer payments are untouched. Customer payments are never part of this refund.",
                ...(access.founding.price ? ["Founding-member pricing ends and doesn't come back."] : []),
                "This refund is once per business.",
              ],
              action: "Refund and return to Free",
              destructive: true,
            }}
          />
        </section>
      ) : null}

      {receipts.length ? (
        <section className="rounded-2xl border bg-card p-6 sm:p-8">
          <p className="text-muted-foreground font-label text-[11px] uppercase">Receipts</p>
          <div className="mt-3 flex flex-col">
            {receipts.map((receipt, index) => (
              <div key={receipt.id} className={`flex items-center justify-between py-2.5 text-sm ${index ? "border-t" : ""}`}>
                <span>{dateOf(new Date(receipt.created * 1000))}</span>
                <div className="flex items-center gap-4">
                  <span className="text-muted-foreground tabular-nums">{formatMoney(receipt.amountPaidCents, { forceCents: true })}</span>
                  {receipt.pdfUrl ? (
                    <a href={receipt.pdfUrl} target="_blank" rel="noreferrer" className="text-primary-ink underline underline-offset-4">
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
        <p className="text-muted-foreground text-sm">Leaving? Export everything first — it stays available either way.</p>
        {overview.bill && !access.cancelAtPeriodEnd ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/account/billing/cancel">Cancel membership</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
