"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Sends the user to Stripe Checkout. The server creates the session; the client
 * only follows the URL it returns.
 */
export function CheckoutButton({
  priceId,
  organizationId,
  children,
}: {
  priceId: string;
  organizationId: string;
  children?: React.ReactNode;
}) {
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId, organizationId }),
      });

      // The API answers { data } on success and { error } on failure.
      const payload = (await response.json()) as {
        data?: { url?: string };
        error?: { message?: string };
      };

      if (!response.ok || !payload.data?.url) {
        throw new Error(payload.error?.message ?? "Could not start checkout.");
      }

      window.location.href = payload.data.url;
    } catch (error) {
      setPending(false);
      toast.error(
        error instanceof Error ? error.message : "Could not start checkout."
      );
    }
  }

  return (
    <Button onClick={start} disabled={pending} className="w-full">
      {pending ? <Loader2Icon className="animate-spin" /> : null}
      {children ?? "Subscribe"}
    </Button>
  );
}
