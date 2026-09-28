"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BillingInterval, PackId, PaidTier } from "@/lib/membership/catalog";

/**
 * Sends the contractor to Stripe Checkout for a configuration — tier,
 * interval, packs. The server picks the prices (public or founding) and
 * creates the session; the client only follows the URL it returns.
 */
export function CheckoutButton({
  tier,
  interval,
  packs,
  returnPath,
  children,
}: {
  tier: PaidTier;
  interval: BillingInterval;
  packs: PackId[];
  returnPath?: string;
  children?: React.ReactNode;
}) {
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, interval, packs, returnPath }),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: { url?: string };
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.data?.url) {
        throw new Error(payload?.error?.message ?? "Could not start checkout.");
      }
      window.location.href = payload.data.url;
    } catch (error) {
      setPending(false);
      toast.error(error instanceof Error ? error.message : "Could not start checkout.");
    }
  }

  return (
    <Button onClick={start} disabled={pending} className="w-full">
      {pending ? <Loader2Icon className="animate-spin" /> : null}
      {children ?? "Continue to payment"}
    </Button>
  );
}
