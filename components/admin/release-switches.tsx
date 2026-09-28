"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Release = { key: string; label: string; detail: string; enabled: boolean };

/**
 * What's on sale — Billing §2.2, §6, §7, §14.2. One switch per release, and
 * the founding offer's launch date beside it. Owner-only on the server;
 * everyone else sees them read-only.
 */
export function ReleaseSwitches({
  releases,
  launchedAt,
  owner,
}: {
  releases: Release[];
  launchedAt: string | null;
  owner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(launchedAt ? launchedAt.slice(0, 10) : "");

  function patch(key: string, body: Record<string, unknown>, done: string) {
    startTransition(async () => {
      const response = await fetch(`/api/v1/admin/billing/releases/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        toast.error(payload?.error?.message ?? "That didn't change.");
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  async function sweep() {
    startTransition(async () => {
      const response = await fetch("/api/v1/admin/billing/sweep", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as {
        data?: { reconciled: number; notices: number; writtenOff: string[]; diverged: string[] };
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.data) {
        toast.error(payload?.error?.message ?? "The sweep didn't run.");
        return;
      }
      const { reconciled, notices, writtenOff, diverged } = payload.data;
      toast.success(
        `Reconciled ${reconciled}, ${diverged.length} out of step, ${notices} notices sent, ${writtenOff.length} written off.`
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border">
        {releases.map((release, index) => (
          <div key={release.key} className={`flex items-start justify-between gap-4 px-5 py-4 ${index ? "border-t" : ""}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium">{release.label}</p>
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{release.detail}</p>
              {release.key === "founding_offer" ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="launch" className="text-xs">Paid launch date</Label>
                    <Input
                      id="launch"
                      type="date"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                      disabled={!owner || pending}
                      className="h-8 w-44"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!owner || pending || !date}
                    onClick={() => patch("founding_offer", { launchedAt: new Date(`${date}T12:00:00Z`).toISOString() }, "Launch date saved.")}
                  >
                    Save date
                  </Button>
                </div>
              ) : null}
            </div>
            <Switch
              checked={release.enabled}
              disabled={!owner || pending}
              onCheckedChange={(enabled) =>
                patch(release.key, { enabled }, enabled ? `${release.label} is on sale.` : `${release.label} is off sale.`)
              }
              aria-label={release.label}
            />
          </div>
        ))}
      </div>
      <div>
        <Button variant="outline" size="sm" onClick={sweep} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Run the membership sweep now
        </Button>
      </div>
    </div>
  );
}
