"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadStripe,
  type Stripe,
  type StripeElements,
} from "@stripe/stripe-js";
import { CreditCard, Landmark, Loader2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";

type Rail = "card" | "ach";

type Intent = {
  clientSecret: string;
  stripeAccount: string;
  publishableKey?: string | null;
};

/**
 * Paying an invoice on the customer's link — Flow 2's last step, Billing §8.
 *
 * **She picks how to pay first** — card or bank — and the form is made for
 * that. The invoice amount is the same either way; any fee comes out of the
 * business's side, never hers. **Stripe's own form, on the contractor's
 * account**: the business is the merchant, and card or bank details go to
 * Stripe and nowhere else.
 *
 * **A bank payment is "on its way", never "paid"** until it clears (§8.3) —
 * the message says so, and the page shows it as processing.
 */
export function InvoicePayment({
  token,
  amountLabel,
  businessName,
  paidMessage,
  failureNote,
  rails,
}: {
  token: string;
  amountLabel: string;
  businessName: string | null;
  paidMessage: string;
  failureNote: string;
  rails: { card: boolean; ach: boolean };
}) {
  const mount = useRef<HTMLDivElement>(null);
  const stripe = useRef<Stripe | null>(null);
  const elements = useRef<StripeElements | null>(null);

  const both = rails.card && rails.ach;

  const [rail, setRail] = useState<Rail | null>(both ? null : rails.ach ? "ach" : "card");
  const [stage, setStage] = useState<
    "choosing" | "loading" | "ready" | "paying" | "paid" | "processing" | "verify" | "unavailable"
  >(both ? "choosing" : "loading");
  const [error, setError] = useState<string | null>(null);
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const started = useRef<Rail | null>(null);

  const business = businessName ?? "the business";

  async function start(chosen: Rail) {
    if (started.current === chosen) return;
    started.current = chosen;
    setRail(chosen);
    setStage("loading");
    setError(null);

    try {
      const response = await fetch(`/api/share/${token}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rail: chosen }),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: Intent;
        error?: { message?: string } | string;
      } | null;

      if (!response.ok || !body?.data) {
        const message = typeof body?.error === "object" ? body.error.message : undefined;
        throw new Error(message ?? `This can't be paid online right now. Get in touch with ${business} to arrange payment.`);
      }

      const intent = body.data;
      if (!intent.publishableKey) {
        throw new Error(`Online payments aren't available right now. Get in touch with ${business} to arrange payment.`);
      }

      const loaded = await loadStripe(intent.publishableKey, { stripeAccount: intent.stripeAccount });
      if (!loaded || !mount.current) {
        throw new Error("The payment form didn't load. Refresh the page to try again.");
      }

      mount.current.innerHTML = "";
      const form = loaded.elements({ clientSecret: intent.clientSecret });
      form.create("payment").mount(mount.current);

      stripe.current = loaded;
      elements.current = form;
      setStage("ready");
    } catch (cause) {
      started.current = null;
      setError(cause instanceof Error ? cause.message : "The payment form didn't load. Refresh the page to try again.");
      setStage(both ? "choosing" : "unavailable");
    }
  }

  useEffect(() => {
    // Back from a bank's own confirmation page. The ledger catches up when
    // Stripe's event lands; asking again now would charge twice.
    void (async () => {
      const back = new URLSearchParams(window.location.search).get("redirect_status");
      if (back === "succeeded") return setStage("paid");
      if (back === "processing") return setStage("processing");
      // One rail offered: open its form straight away.
      if (!both && rail) await start(rail);
    })();
    // Once per page: a second intent per render would leave abandoned
    // payments on the contractor's account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setError(`${result.error.message ?? "That payment didn't go through."} ${failureNote}`);
      setStage("ready");
      return;
    }

    const intent = result.paymentIntent;
    if (intent?.status === "processing") {
      setStage("processing");
      return;
    }
    if (intent?.status === "requires_action" && intent.next_action?.type === "verify_with_microdeposits") {
      setVerifyUrl(intent.next_action.verify_with_microdeposits?.hosted_verification_url ?? null);
      setStage("verify");
      return;
    }
    setStage("paid");
  }

  if (stage === "paid") {
    return <p className="rounded-md border px-4 py-3 text-center text-sm leading-relaxed">{paidMessage}</p>;
  }

  if (stage === "processing") {
    return (
      <p className="rounded-md border px-4 py-3 text-center text-sm leading-relaxed">
        Your bank payment is on its way. Bank payments take a few business days to clear — {business} sees it as
        processing until then, and nothing more is due while it does.
      </p>
    );
  }

  if (stage === "verify") {
    return (
      <p className="rounded-md border px-4 py-3 text-center text-sm leading-relaxed">
        Your bank needs one more step: in 1–2 business days you&apos;ll see a small deposit from Stripe.{" "}
        {verifyUrl ? (
          <a href={verifyUrl} className="underline underline-offset-4">
            Confirm it here
          </a>
        ) : (
          "Follow the email from Stripe to confirm it"
        )}{" "}
        and the payment goes through.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {both ? (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How to pay">
          <Button
            variant={rail === "card" ? "default" : "outline"}
            className="h-12"
            onClick={() => start("card")}
            disabled={stage === "loading" || stage === "paying"}
            role="radio"
            aria-checked={rail === "card"}
          >
            <CreditCard />
            Card
          </Button>
          <Button
            variant={rail === "ach" ? "default" : "outline"}
            className="h-12"
            onClick={() => start("ach")}
            disabled={stage === "loading" || stage === "paying"}
            role="radio"
            aria-checked={rail === "ach"}
          >
            <Landmark />
            Bank account
          </Button>
        </div>
      ) : null}

      {stage !== "unavailable" ? <div ref={mount} className={stage === "choosing" ? "hidden" : "min-h-10"} /> : null}

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

      {stage === "ready" || stage === "paying" ? (
        <Button size="lg" className="h-12 text-base" onClick={pay} disabled={stage !== "ready"}>
          {stage === "paying" ? <Loader2 className="animate-spin" /> : null}
          Pay {amountLabel}
        </Button>
      ) : null}

      {stage !== "unavailable" ? (
        <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-center text-xs">
          <Lock className="size-3 shrink-0" />
          {rail === "ach"
            ? `Bank details go straight to Stripe. A bank payment takes a few business days to clear.`
            : `Card details go straight to Stripe. ${businessName ?? "The business"} never sees your card number.`}
        </p>
      ) : null}
    </div>
  );
}
