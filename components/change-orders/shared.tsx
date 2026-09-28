"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { ResponsePanel } from "@/components/share/frame";
import { ConsentNotice } from "@/components/signing/consent-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiJson } from "@/lib/api/client";

/**
 * Answering a change order — the panel under the page on the customer's link.
 *
 * **Approving is signing.** A typed name and the electronic-records consent,
 * the same as every other signature she gives here; declining needs neither,
 * because it changes nothing. The page above is what she's agreeing to — the
 * hash of it goes with her answer, so a change edited after she opened it is
 * refused rather than approved sight unseen.
 */
export function ChangeOrderResponse({
  token,
  hash,
  status,
  canSign,
  customerName,
  businessName,
}: {
  token: string;
  hash: string;
  status: string;
  canSign: boolean;
  customerName: string | null;
  businessName: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(customerName ?? "");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status === "approved") {
    return (
      <ResponsePanel
        title="Approved"
        description="This change is part of your agreement now."
      />
    );
  }
  if (status === "declined") {
    return (
      <ResponsePanel
        title="Declined"
        description="Your agreement hasn't changed."
      />
    );
  }
  if (status !== "sent" || !canSign) return null;

  async function respond(decision: "approve" | "decline") {
    setBusy(decision);
    setError(null);
    try {
      await apiJson(`/api/share/${token}/change-order`, "POST", {
        decision,
        hash,
        printedName: name.trim(),
        consented: consent,
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't record your answer.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ResponsePanel
      title="Approve this change?"
      description="Signing approves the work, the price change and the schedule above. It doesn't charge anything."
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="co-name">Full name</Label>
        <Input
          id="co-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          disabled={busy !== null}
        />
      </div>

      <ConsentNotice
        checked={consent}
        onCheckedChange={setConsent}
        businessName={businessName}
        disabled={busy !== null}
      />

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          size="lg"
          className="h-12 flex-1 text-base"
          disabled={busy !== null || !name.trim() || !consent}
          onClick={() => respond("approve")}
        >
          {busy === "approve" ? <Loader2 className="animate-spin" /> : null}
          Sign & approve
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-12 text-base"
          disabled={busy !== null}
          onClick={() => respond("decline")}
        >
          {busy === "decline" ? <Loader2 className="animate-spin" /> : null}
          Decline
        </Button>
      </div>
    </ResponsePanel>
  );
}
