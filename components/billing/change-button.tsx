"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { ConfirmChange, post, type Preview } from "@/components/billing/plan-picker";
import { Button } from "@/components/ui/button";
import type { BillingInterval, PackId, PaidTier } from "@/lib/membership/catalog";

/**
 * One specific change to a paying shop's membership — add a pack, remove it
 * at renewal — with the same preview and confirmation as the plan picker
 * (Billing §5.2). The target is the configuration from the next renewal on;
 * the server splits it into what's charged now and what waits.
 */
export function ChangeButton({
  target,
  label,
  variant = "default",
  size = "default",
}: {
  target: { tier: PaidTier; interval: BillingInterval; packs: PackId[] };
  label: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  async function review() {
    setBusy(true);
    try {
      setPreview(await post<Preview>("/api/v1/membership/preview", target));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That didn't work. Nothing was charged.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await post<{ status: string; invoiceUrl?: string | null; message?: string }>(
        "/api/v1/membership/change",
        { ...target, prorationDate: preview.immediate?.prorationDate ?? Math.floor(Date.now() / 1000) }
      );
      if (result.status === "payment_required") {
        toast.error(result.message ?? "The payment needs finishing.");
        if (result.invoiceUrl) window.location.href = result.invoiceUrl;
        return;
      }
      toast.success("Your membership is updated.");
      setPreview(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That didn't work. Nothing was charged.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={review} disabled={busy}>
        {busy && !preview ? <Loader2 className="animate-spin" /> : null}
        {label}
      </Button>
      {preview ? (
        <ConfirmChange
          tier={target.tier}
          interval={target.interval}
          packs={target.packs}
          preview={preview}
          busy={busy}
          onCancel={() => setPreview(null)}
          onConfirm={confirm}
        />
      ) : null}
    </>
  );
}
