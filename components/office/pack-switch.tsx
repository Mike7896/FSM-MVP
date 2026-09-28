"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/**
 * Turning a trade pack on or off.
 *
 * **Off is not the same as gone.** A contractor who works two trades needs to
 * switch one off without losing it or re-buying it, so this writes enablement
 * and never touches entitlement — and a quote written under a disabled pack
 * stays complete and openable, because the document is a record of what was
 * sent and pack state must never rewrite history.
 *
 * Optimism is deliberately absent: the switch reflects what the server
 * confirmed, not what was clicked. This governs which taxonomy the editor
 * loads, and a switch that reads on while the pack is off is worse than a
 * moment of latency.
 */
export function PackSwitch({
  packId,
  packName,
  enabled,
}: {
  packId: string;
  packName: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    startTransition(async () => {
      const response = await fetch(`/api/v1/packs/${packId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        toast.error(body?.error?.message ?? "Couldn't change that.");
        return;
      }

      toast.success(
        next
          ? `${packName} is on. New quotes use its templates.`
          : `${packName} is off. Quotes already written with it are untouched.`
      );
      router.refresh();
    });
  }

  return (
    <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
      <Switch
        checked={enabled}
        disabled={pending}
        onCheckedChange={toggle}
        aria-label={`${packName} pack`}
      />
      {enabled ? "On" : "Off"}
    </Label>
  );
}
