"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TIER_FEATURES,
  TIER_LABEL,
  type BillingInterval,
  type PackId,
  type PaidTier,
} from "@/lib/membership/catalog";
import { formatMoney } from "@/lib/quote/money";
import { cn } from "@/lib/utils";

/**
 * Choosing a plan — the one picker behind the pricing page, the in-app
 * upgrade, and plan changes (Billing §2.1, §5.2, §12).
 *
 * **The total first.** With the Electrical pack ticked every card shows what
 * the shop will actually pay, core and pack together; the arithmetic sits
 * underneath. The pack is never pre-ticked, and it says it needs Starter or
 * Pro. Every amount is a Stripe price passed in from the server — nothing here
 * is a number of its own.
 *
 * What the button does depends on where the picker is: a signup link on the
 * public page, Stripe Checkout for a Free shop, and preview → confirm for a
 * shop that already pays.
 */

type Cents = number | null;

export type PickerPricing = {
  core: Record<PaidTier, Record<BillingInterval, Cents>>;
  founder: Record<PaidTier, Record<BillingInterval, Cents>>;
  packs: Record<PackId, Record<BillingInterval, Cents>>;
  /** Server-decided: founding prices apply to this viewer. */
  founding: boolean;
  foundingRemaining: number | null;
  proAvailable: boolean;
  electricalAvailable: boolean;
};

export type CurrentConfig = {
  tier: PaidTier;
  interval: BillingInterval;
  packs: PackId[];
} | null;

type Mode =
  | { kind: "public"; signUpHref: string }
  | { kind: "checkout"; returnPath?: string }
  | { kind: "change"; current: CurrentConfig; canChange: boolean; blockedReason?: string };

export type Preview = {
  immediate: {
    dueNowCents: number;
    taxCents: number;
    addedToNextBill: boolean;
    prorationDate: number;
  } | null;
  scheduled: { config: { tier: PaidTier; interval: BillingInterval; packs: PackId[] }; effectiveAt: string } | null;
  renewalCents: number | null;
  renewalAt: string | null;
  resumesCancelled: boolean;
};

const GB = 1024 ** 3;

function featureLines(tier: PaidTier | "free") {
  const f = TIER_FEATURES[tier];
  return [
    f.monthlyActivations === null ? "Unlimited active jobs" : `${f.monthlyActivations} new jobs each month`,
    ...(tier === "free" ? ["Quotes, contracts and invoices", "Deposits, progress billing and payments", "ServiceClerk footer on documents"] : []),
    ...(tier === "starter" ? ["Every Free workflow included", "No ServiceClerk footer"] : []),
    ...(tier === "pro" ? ["Everything in Starter", "Your logo on documents", "Quote-view tracking", "Business analytics", "Priority email support"] : []),
    `${Math.round(f.storageBytes / GB)} GB of attachment storage`,
  ];
}

function per(interval: BillingInterval) {
  return interval === "year" ? "/yr" : "/mo";
}

export function PlanPicker({
  pricing,
  mode,
  initial,
  showFree = false,
}: {
  pricing: PickerPricing;
  mode: Mode;
  initial?: { interval?: BillingInterval; packs?: PackId[] };
  showFree?: boolean;
}) {
  const router = useRouter();
  const current = mode.kind === "change" ? mode.current : null;
  const [interval, setInterval] = useState<BillingInterval>(initial?.interval ?? current?.interval ?? "month");
  const [electrical, setElectrical] = useState<boolean>(
    initial?.packs?.includes("electrical") ?? current?.packs.includes("electrical") ?? false
  );
  const [busy, setBusy] = useState<PaidTier | null>(null);
  const [confirming, setConfirming] = useState<{ tier: PaidTier; preview: Preview } | null>(null);

  const packSelectable = pricing.electricalAvailable || Boolean(current?.packs.includes("electrical"));
  const packs: PackId[] = electrical && packSelectable ? ["electrical"] : [];
  const tiers: PaidTier[] = pricing.proAvailable || current?.tier === "pro" ? ["starter", "pro"] : ["starter"];

  const priceOf = useMemo(
    () => (tier: PaidTier, at: BillingInterval) => {
      const core = (pricing.founding ? pricing.founder : pricing.core)[tier][at];
      const pack = packs.length ? pricing.packs.electrical[at] : 0;
      return core === null || pack === null ? null : core + pack;
    },
    [pricing, packs.length]
  );

  async function choose(tier: PaidTier) {
    const target = { tier, interval, packs };
    if (mode.kind === "public") {
      const query = new URLSearchParams({ plan: tier, interval, ...(packs.length ? { pack: "electrical" } : {}) });
      router.push(`${mode.signUpHref}?${query.toString()}`);
      return;
    }

    setBusy(tier);
    try {
      if (mode.kind === "checkout") {
        // Confirm the bill on our own page first, then Stripe's (Screen 31).
        const query = new URLSearchParams({
          plan: tier,
          interval,
          ...(packs.length ? { pack: "electrical" } : {}),
          ...(mode.returnPath ? { next: mode.returnPath } : {}),
        });
        router.push(`/upgrade/checkout?${query.toString()}`);
        return;
      }
      const preview = await post<Preview>("/api/v1/membership/preview", target);
      setConfirming({ tier, preview });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That didn't work. Nothing was charged.");
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!confirming) return;
    const prorationDate = confirming.preview.immediate?.prorationDate ?? Math.floor(Date.now() / 1000);
    setBusy(confirming.tier);
    try {
      const result = await post<{ status: string; invoiceUrl?: string | null; message?: string }>(
        "/api/v1/membership/change",
        { tier: confirming.tier, interval, packs, prorationDate }
      );
      if (result.status === "payment_required") {
        toast.error(result.message ?? "The payment needs finishing.");
        if (result.invoiceUrl) window.location.href = result.invoiceUrl;
        return;
      }
      toast.success("Your membership is updated.");
      setConfirming(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That didn't work. Nothing was charged.");
    } finally {
      setBusy(null);
    }
  }

  const isCurrent = (tier: PaidTier) =>
    current !== null &&
    current.tier === tier &&
    current.interval === interval &&
    current.packs.join() === packs.join();

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-muted/60 p-3 sm:p-4">
        <Tabs value={interval} onValueChange={(value) => setInterval(value as BillingInterval)}>
          <TabsList>
            <TabsTrigger value="month">Monthly</TabsTrigger>
            <TabsTrigger value="year">Annual · 2 months free</TabsTrigger>
          </TabsList>
        </Tabs>

        {packSelectable ? (
          <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
            <Checkbox checked={electrical} onCheckedChange={(value) => setElectrical(value === true)} />
            Add the Electrical pack
            <span className="text-muted-foreground tabular-nums">
              {pricing.packs.electrical[interval] === null ? "" : `+${formatMoney(pricing.packs.electrical[interval]!)}${per(interval)}`}
            </span>
          </Label>
        ) : null}
      </div>

      {pricing.founding ? (
        <p className="border-primary/40 bg-primary/[0.04] rounded-lg border px-4 py-3 text-sm">
          <strong className="font-medium">Founding-member pricing.</strong> Founding core pricing while your paid
          membership stays active{pricing.foundingRemaining !== null ? ` — ${pricing.foundingRemaining} of 50 places left` : ""}.
          Packs are priced as usual.
        </p>
      ) : null}

      <div
        className={cn(
          "grid items-stretch gap-5",
          { 1: "md:max-w-md", 2: "md:grid-cols-2", 3: "md:grid-cols-3" }[tiers.length + (showFree ? 1 : 0)] ?? "md:grid-cols-3"
        )}
      >
        {showFree ? (
          <div className="flex flex-col rounded-2xl border bg-card p-6 sm:p-8">
            <h2 className="text-xl font-semibold tracking-tight">Free</h2>
            <p className="mt-6 text-5xl font-semibold tracking-tight tabular-nums">$0</p>
            <p className="text-muted-foreground mt-3 min-h-10 text-xs leading-relaxed">No card required. No subscription.</p>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              Activate three jobs each month, and finish and collect on them without using another.
            </p>
            <Features lines={featureLines("free")} />
            <Button asChild variant="outline" className="mt-8 h-11 w-full">
              <a href={mode.kind === "public" ? mode.signUpHref : "/dashboard"}>Start free</a>
            </Button>
          </div>
        ) : null}

        {tiers.map((tier) => {
          const total = priceOf(tier, interval);
          const monthly = priceOf(tier, "month");
          const core = (pricing.founding ? pricing.founder : pricing.core)[tier][interval];
          const publicCore = pricing.core[tier][interval];
          const selected = isCurrent(tier);
          return (
            <div
              key={tier}
              className={cn("relative flex flex-col rounded-2xl border bg-card p-6 sm:p-8", tier === "starter" && "border-primary shadow-sm ring-1 ring-primary/30", selected && "bg-primary/[0.04]")}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xl font-semibold tracking-tight">
                  {TIER_LABEL[tier]}
                  {packs.length ? " + Electrical" : ""}
                </h2>
                {selected ? <Badge variant="secondary">Your plan</Badge> : tier === "starter" ? <Badge variant="secondary">For everyday work</Badge> : null}
              </div>

              <p className="mt-6 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
                {total === null ? "Not on sale yet" : formatMoney(total)}
                {total === null ? null : <span className="text-muted-foreground text-sm font-normal">{per(interval)}</span>}
              </p>
              <p className="text-muted-foreground mt-3 min-h-10 text-xs leading-relaxed tabular-nums">
                {[
                  packs.length && core !== null && pricing.packs.electrical[interval] !== null
                    ? `${formatMoney(core)} ${TIER_LABEL[tier]} + ${formatMoney(pricing.packs.electrical[interval]!)} Electrical`
                    : null,
                  interval === "year" && total !== null ? `${formatMoney(Math.round(total / 12), { forceCents: true })}/mo equivalent` : null,
                  interval === "year" && total !== null && monthly !== null ? `save ${formatMoney(monthly * 12 - total)}` : null,
                  pricing.founding && publicCore !== null && core !== null && publicCore !== core
                    ? `usually ${formatMoney(publicCore)}`
                    : null,
                  total === null ? null : "plus applicable tax",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>

              <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                {tier === "starter"
                  ? "Unlimited jobs and every money workflow, for one shop."
                  : "Everything in Starter, plus your logo, quote-view tracking and business analytics."}
              </p>
              <Features lines={featureLines(tier)} />

              <div className="mt-8">
                {mode.kind === "change" && !mode.canChange ? (
                  <Button disabled variant="outline" className="h-11 w-full">
                    {mode.blockedReason ?? "Settle your bill first"}
                  </Button>
                ) : (
                  <Button
                    className="h-11 w-full"
                    variant={selected ? "outline" : "default"}
                    disabled={selected || total === null || busy !== null}
                    onClick={() => choose(tier)}
                  >
                    {busy === tier ? <Loader2 className="animate-spin" /> : null}
                    {selected ? "Your plan" : cta(mode, tier, current)}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {pricing.electricalAvailable ? (
        <p className="text-muted-foreground text-xs">
          The Electrical pack requires Starter or Pro. It renews with your plan on the same date and interval.
        </p>
      ) : null}

      {confirming ? (
        <ConfirmChange
          tier={confirming.tier}
          interval={interval}
          packs={packs}
          preview={confirming.preview}
          busy={busy !== null}
          onCancel={() => setConfirming(null)}
          onConfirm={confirm}
        />
      ) : null}
    </div>
  );
}

function cta(mode: Mode, tier: PaidTier, current: CurrentConfig) {
  if (mode.kind === "public") return `Start with ${TIER_LABEL[tier]}`;
  if (mode.kind === "checkout") return `Continue with ${TIER_LABEL[tier]}`;
  if (!current) return `Choose ${TIER_LABEL[tier]}`;
  return "Review this change";
}

function Features({ lines }: { lines: string[] }) {
  return (
    <ul className="mt-6 flex flex-1 flex-col gap-3 border-t pt-6 text-sm leading-relaxed">
      {lines.map((line) => (
        <li key={line} className="flex items-start gap-2">
          <Check className="text-primary-ink mt-1 size-4 shrink-0" aria-hidden="true" />
          {line}
        </li>
      ))}
    </ul>
  );
}

export function ConfirmChange({
  tier,
  interval,
  packs,
  preview,
  busy,
  onCancel,
  onConfirm,
}: {
  tier: PaidTier;
  interval: BillingInterval;
  packs: PackId[];
  preview: Preview;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const due = preview.immediate?.dueNowCents ?? 0;
  const renewalOn = preview.renewalAt ? dateOf(preview.renewalAt) : null;
  const scheduledOn = preview.scheduled ? dateOf(preview.scheduled.effectiveAt) : null;

  const rows: [string, string][] = [];
  if (preview.immediate) {
    rows.push([
      "Due now",
      preview.immediate.addedToNextBill
        ? `${formatMoney(due, { forceCents: true })} — too small to charge on its own, so it's added to your next bill`
        : `${formatMoney(due, { forceCents: true })}${preview.immediate.taxCents ? ` (incl. ${formatMoney(preview.immediate.taxCents, { forceCents: true })} tax)` : ""}, for the rest of this period`,
    ]);
    rows.push(["Starts", preview.immediate.addedToNextBill || due === 0 ? "Immediately after confirmation" : "As soon as the payment goes through"]);
  } else {
    rows.push(["Due now", "Nothing"]);
  }
  if (preview.scheduled && scheduledOn) {
    rows.push(["Changes on", `${scheduledOn} — you keep what you have until then`]);
  }
  if (preview.renewalCents !== null && renewalOn) {
    rows.push(["Then", `${formatMoney(preview.renewalCents)}${per(preview.scheduled?.config.interval ?? interval)} plus applicable tax, from ${renewalOn}`]);
  }
  if (preview.resumesCancelled) {
    rows.push(["Cancellation", "Your scheduled cancellation is undone"]);
  }

  const label = preview.immediate && !preview.immediate.addedToNextBill && due > 0
    ? `Pay ${formatMoney(due, { forceCents: true })} and switch`
    : preview.immediate
      ? "Switch now"
      : "Schedule the change";

  return (
    <ResponsiveDialog open onOpenChange={(open) => (open ? null : onCancel())}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-md">
        <ResponsiveDialogHeader
          title={`${TIER_LABEL[tier]}${packs.length ? " + Electrical" : ""}, ${interval === "year" ? "annual" : "monthly"}`}
          description="Here's exactly what happens to your bill."
        />
        <ResponsiveDialogBody>
          <div className="flex flex-col">
            {rows.map(([label, value], index) => (
              <div key={label} className={cn("flex flex-col gap-0.5 py-2.5 text-sm sm:flex-row sm:gap-4", index ? "border-t" : "")}>
                <span className="text-muted-foreground font-label w-28 shrink-0 text-[11px] uppercase">{label}</span>
                <span className="tabular-nums">{value}</span>
              </div>
            ))}
          </div>
          <Separator className="my-4" />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Keep my plan
            </Button>
            <Button onClick={onConfirm} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {label}
            </Button>
          </div>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function dateOf(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error?.message ?? "That didn't work. Nothing was charged.");
  }
  return payload.data;
}
