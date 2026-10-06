import "server-only";

import type Stripe from "stripe";

import { reportError } from "@/lib/observability";
import { formatMoney } from "@/lib/quote/money";

import { releaseFoundingHold } from "./founding";
import { sendNotice } from "./notices";
import { reconcileCheckoutSession, reconcileSubscription as projectSubscription } from "./reconcile";
import { recoverPlanChange } from "./changes";
import { recordPlatformInvoice } from "./revenue";

async function reconcileSubscription(subscriptionId: string) {
  const account = await projectSubscription(subscriptionId);
  if (!account) return null;
  // A paid pending upgrade may also carry a saved renewal change. Finish it
  // before acknowledging this event; failure lets Stripe retry the event.
  await recoverPlanChange(account.organizationId);
  return projectSubscription(subscriptionId);
}

/**
 * The membership's half of the platform webhook.
 *
 * Every handler ends in `reconcileSubscription`, which retrieves the
 * subscription fresh — so what an event *says* only decides which
 * subscription to look at, never what access it grants (§11.2).
 */

export const MEMBERSHIP_EVENTS = new Set<Stripe.Event.Type>([
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "subscription_schedule.created",
  "subscription_schedule.updated",
  "subscription_schedule.released",
  "subscription_schedule.canceled",
  "subscription_schedule.completed",
  "subscription_schedule.aborted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
]);

function subscriptionOfInvoice(invoice: Stripe.Invoice): string | null {
  const ref = invoice.parent?.subscription_details?.subscription;
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

export async function handleMembershipEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const organizationId = session.metadata?.organizationId;
      if (session.mode === "subscription" && organizationId) {
        await reconcileCheckoutSession(session.id, organizationId);
      }
      return;
    }

    case "checkout.session.expired": {
      const session = event.data.object;
      const organizationId = session.metadata?.organizationId;
      if (organizationId && session.metadata?.founding === "true") {
        await releaseFoundingHold(organizationId, session.id);
      }
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.pending_update_applied":
    case "customer.subscription.pending_update_expired":
      await reconcileSubscription(event.data.object.id);
      return;

    case "subscription_schedule.created":
    case "subscription_schedule.updated":
    case "subscription_schedule.released":
    case "subscription_schedule.canceled":
    case "subscription_schedule.completed":
    case "subscription_schedule.aborted": {
      const schedule = event.data.object;
      const ref = schedule.subscription ?? schedule.released_subscription;
      const id = typeof ref === "string" ? ref : ref?.id;
      if (id) await reconcileSubscription(id);
      return;
    }

    case "invoice.paid": {
      const invoice = event.data.object;
      const id = subscriptionOfInvoice(invoice);
      const account = id ? await reconcileSubscription(id) : null;
      // The dashboard's copy of the cash. Never fails the webhook: access
      // already followed the payment, and a missing row is reported.
      await recordPlatformInvoice(invoice, account?.organizationId ?? null).catch((error: unknown) =>
        reportError("[membership] couldn't record a paid invoice for the dashboard:", error, { extra: { invoice: invoice.id } })
      );
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const id = subscriptionOfInvoice(invoice);
      if (!id) return;
      const account = await reconcileSubscription(id);
      // A failed renewal starts the grace clock and its notices (§5.3). A
      // declined upgrade changes nothing, and the person was on the screen.
      if (account && invoice.billing_reason === "subscription_cycle") {
        await sendNotice(account.organizationId, {
          key: `dunning:${invoice.id}:0`,
          title: "Your ServiceClerk renewal didn't go through",
          body: `We couldn't charge ${formatMoney(invoice.amount_due)} for your membership. Everything keeps working for 7 days while we retry — update your card to settle it.`,
        });
      }
      return;
    }

    case "invoice.payment_action_required": {
      const invoice = event.data.object;
      const id = subscriptionOfInvoice(invoice);
      if (!id) return;
      const account = await reconcileSubscription(id);
      if (account) {
        await sendNotice(account.organizationId, {
          key: `action:${invoice.id}`,
          title: "Your bank wants to confirm a ServiceClerk payment",
          body: "Confirm the payment with your bank to finish it. Nothing changes until it's confirmed.",
          href: invoice.hosted_invoice_url ?? "/account/billing",
        });
      }
      return;
    }
  }
}
