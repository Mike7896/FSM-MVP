"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadStripe,
  type Stripe,
  type StripeElements,
} from "@stripe/stripe-js";
import { Loader2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";

type Intent = {
  clientSecret: string;
  stripeAccount: string;
  publishableKey?: string | null;
};

/**
 * Paying an invoice by card, on the customer's link — Flow 2's last step.
 *
 * **Stripe's own form, on the contractor's account.** The charge is a direct
 * charge created by `/api/share/[token]/pay`, so Stripe.js is loaded against
 * the connected account — the business is the merchant, and the card number
 * goes to Stripe and nowhere else.
 *
 * **The amount is on the button** ("Pay $1,455", not "Pay now") — on a money
 * surface the number is what happens. A declined card says what went wrong and
 * keeps the form, with nothing already given lost.
 */
export function InvoicePayment({
  token,
  amountLabel,
  businessName,
  paidMessage,
  failureNote,
}: {
  token: string;
  amountLabel: string;
  businessName: string | null;
  paidMessage: string;
  failureNote: string;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const stripe = useRef<Stripe | null>(null);
  const elements = useRef<StripeElements | null>(null);

  const [stage, setStage] = useState<
    "loading" | "ready" | "paying" | "paid" | "unavailable"
  >("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Once per page. A second intent per open would leave an abandoned payment
    // on the contractor's Stripe account every time the page re-rendered.
    if (started.current) return;
    started.current = true;

    const business = businessName ?? "the business";

    (async () => {
      // Back from a bank's own confirmation page, already paid. The ledger
      // catches up when Stripe's event lands; asking again now would charge
      // twice.
      if (
        new URLSearchParams(window.location.search).get("redirect_status") ===
        "succeeded"
      ) {
        setStage("paid");
        return;
      }

      try {
        const response = await fetch(`/api/share/${token}/pay`, {
          method: "POST",
        });
        const body = (await response.json().catch(() => null)) as {
          data?: Intent;
          error?: { message?: string } | string;
        } | null;

        if (!response.ok || !body?.data) {
          const message =
            typeof body?.error === "object" ? body.error.message : undefined;
          throw new Error(
            message ??
              `This can't be paid online right now. Get in touch with ${business} to arrange payment.`
          );
        }

        const intent = body.data;
        if (!intent.publishableKey) {
          throw new Error(
            `Card payments aren't available right now. Get in touch with ${business} to arrange payment.`
          );
        }

        const loaded = await loadStripe(intent.publishableKey, {
          stripeAccount: intent.stripeAccount,
        });
        if (!loaded || !mount.current) {
          throw new Error(
            "The payment form didn't load. Refresh the page to try again."
          );
        }

        const form = loaded.elements({ clientSecret: intent.clientSecret });
        form.create("payment").mount(mount.current);

        stripe.current = loaded;
        elements.current = form;
        setStage("ready");
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The payment form didn't load. Refresh the page to try again."
        );
        setStage("unavailable");
      }
    })();
  }, [token, businessName]);

  async function pay() {
    if (!stripe.current || !elements.current) return;

    setStage("paying");
    setError(null);

    const result = await stripe.current.confirmPayment({
      elements: elements.current,
      redirect: "if_required",
      confirmParams: { return_url: window.location.href },
    });

    if (result.error) {
      setError(
        `${result.error.message ?? "That payment didn't go through."} ${failureNote}`
      );
      setStage("ready");
      return;
    }

    setStage("paid");
  }

  if (stage === "paid") {
    return (
      <p className="rounded-md border px-4 py-3 text-center text-sm leading-relaxed">
        {paidMessage}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {stage !== "unavailable" ? <div ref={mount} className="min-h-10" /> : null}

      {stage === "loading" ? (
        <p className="text-muted-foreground flex items-center justify-center gap-2 text-xs">
          <Loader2 className="size-3 animate-spin" />
          Loading the secure payment form
        </p>
      ) : null}

      {error ? (
        <p className="text-destructive text-center text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {stage !== "unavailable" ? (
        <Button
          size="lg"
          className="h-12 text-base"
          onClick={pay}
          disabled={stage !== "ready"}
        >
          {stage === "paying" ? <Loader2 className="animate-spin" /> : null}
          Pay {amountLabel}
        </Button>
      ) : null}

      {/* Only beside a form that can take a card. */}
      {stage !== "unavailable" ? (
        <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-xs">
          <Lock className="size-3" />
          Card details go straight to Stripe. {businessName ?? "The business"}{" "}
          never sees your card number.
        </p>
      ) : null}
    </div>
  );
}
