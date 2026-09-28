"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Sends the contractor to the Stripe Billing Portal.
 *
 * `cancelSubscriptionId` opens the portal's cancel flow on that subscription
 * instead of its front page — the confirmation and the actual cancellation are
 * Stripe's, not a button of ours that ends a subscription on one click.
 */
async function openPortal(body: {
  organizationId: string;
  cancelSubscriptionId?: string;
}) {
  const response = await fetch("/api/stripe/portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // The API answers { data } on success and { error } on failure.
  const payload = (await response.json()) as {
    data?: { url?: string };
    error?: { message?: string };
  };

  if (!response.ok || !payload.data?.url) {
    throw new Error(
      payload.error?.message ?? "Could not open the billing portal."
    );
  }

  window.location.href = payload.data.url;
}

/** Opens the Stripe Billing Portal. */
export function ManageBillingButton({
  organizationId,
}: {
  organizationId: string;
}) {
  const [pending, setPending] = useState(false);

  async function open() {
    setPending(true);
    try {
      await openPortal({ organizationId });
    } catch (error) {
      setPending(false);
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not open the billing portal."
      );
    }
  }

  return (
    <Button variant="outline" onClick={open} disabled={pending}>
      {pending ? <Loader2Icon className="animate-spin" /> : null}
      Manage billing
    </Button>
  );
}

/**
 * Cancels, by handing over to Stripe's cancel flow.
 *
 * No confirmation of our own in front of it: the page it sits on *is* the
 * consequences, and a second "are you sure" is the retention friction this
 * surface is written against.
 */
export function CancelSubscriptionButton({
  organizationId,
  subscriptionId,
}: {
  organizationId: string;
  subscriptionId: string;
}) {
  const [pending, setPending] = useState(false);

  async function cancel() {
    setPending(true);
    try {
      await openPortal({
        organizationId,
        cancelSubscriptionId: subscriptionId,
      });
    } catch (error) {
      setPending(false);
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not open the cancel page. Nothing has changed."
      );
    }
  }

  return (
    <Button variant="outline" onClick={cancel} disabled={pending}>
      {pending ? <Loader2Icon className="animate-spin" /> : null}
      Cancel subscription
    </Button>
  );
}
