"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, moneyInputValue, parseMoney } from "@/lib/quote";
import type { PhaseGate } from "@/lib/schemas";

/**
 * Billing a job · Flow 6, job I1.
 *
 * **Deposit, draw and final balance are one object with a type attribute**, not
 * three documents. Modelling them as one is what makes "pay it the same way you
 * approved the quote" structurally true rather than aspirational.
 *
 * When a contract is behind the invoice the arithmetic is applied *for* the
 * contractor — the agreed amount including every approved change order, what
 * has already been billed and collected, and what is left. **Invoices source
 * from the Contract, never the Quote**: billing against a superseded quote is
 * exactly how an approved change order gets silently dropped from a bill.
 *
 * When the hub sent him here to bill a scheduled stage, the amount arrives
 * already agreed and is stated as such — "set when she accepted" is what makes
 * a draw not feel like a fresh ask.
 */
export function InvoiceEditor({
  jobId,
  customerName,
  stage,
  contract,
}: {
  jobId: string;
  customerName: string;
  /** The draw-schedule row this bill settles, when there is one. */
  stage: {
    id: string;
    name: string;
    amountCents: number;
    gate: PhaseGate;
    evidenceReady: boolean;
  } | null;
  /** Absent on a standalone bill — there is no agreed document behind it. */
  contract: {
    id: string;
    agreedCents: number;
    billedCents: number;
    collectedCents: number;
  } | null;
}) {
  const router = useRouter();

  // The kind of bill follows from when the phase is due: the deposit at
  // acceptance, the final balance at the end, a draw for everything between.
  const [type, setType] = useState<"deposit" | "draw" | "final_balance">(
    stage?.gate === "on_acceptance"
      ? "deposit"
      : stage && stage.gate !== "on_completion"
        ? "draw"
        : "final_balance"
  );
  const [amountText, setAmountText] = useState(
    moneyInputValue(stage?.amountCents ?? 0)
  );
  const [covers, setCovers] = useState(stage?.name ?? "");
  const [dueOn, setDueOn] = useState("");
  const [saving, setSaving] = useState(false);

  const amountCents = parseMoney(amountText) ?? 0;
  const remaining = contract
    ? contract.agreedCents - contract.collectedCents
    : null;

  async function issue() {
    if (amountCents <= 0) {
      toast.error("How much is this bill for?");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          type,
          amountDueCents: amountCents,
          covers: covers.trim() || undefined,
          dueOn: dueOn || undefined,
          sourceContractId: contract?.id,
          drawScheduleId: stage?.id,
          issue: true,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        data?: { id: string };
        error?: { message?: string };
      } | null;

      if (!response.ok || !body?.data) {
        throw new Error(body?.error?.message ?? "Couldn't create the invoice.");
      }

      router.push(`/invoices/${body.data.id}`);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't create the invoice."
      );
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Customer</Label>
            {/* Not editable here: the bill goes to whoever the job is for, and
                letting it drift from the job is how a payment lands on the
                wrong ledger. */}
            <Input value={customerName} readOnly className="bg-muted/40" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="type">What kind of invoice</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as typeof type)}
            >
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deposit">Deposit</SelectItem>
                <SelectItem value="draw">Draw</SelectItem>
                <SelectItem value="final_balance">Final balance</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="covers">What this covers</Label>
          <Textarea
            id="covers"
            rows={3}
            value={covers}
            onChange={(event) => setCovers(event.target.value)}
            placeholder="What this bill is for, in plain words."
          />
          <p className="text-muted-foreground text-xs">
            She reads this before she reads the number.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="amount">Amount</Label>
            <div className="relative">
              <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm">
                $
              </span>
              <Input
                id="amount"
                inputMode="decimal"
                className="pl-6"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
              />
            </div>
            {stage ? (
              <p className="text-muted-foreground text-xs">
                {/* What makes this not feel like a new ask. */}
                Set when she accepted.
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="due">Due</Label>
            <Input
              id="due"
              type="date"
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
            />
          </div>
        </div>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-22 lg:self-start">
        <div className="rounded-xl border p-5">
          {contract ? (
            <>
              <Row label="Agreed" cents={contract.agreedCents} />
              <Row label="Billed so far" cents={contract.billedCents} />
              <Row label="Collected" cents={contract.collectedCents} />
              <Separator className="my-2" />
              <div className="flex items-baseline justify-between">
                <span className="font-label text-[11px] uppercase">
                  Left to collect
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatMoney(remaining ?? 0)}
                </span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm leading-relaxed">
              There is no contract behind this bill, so nothing is worked out
              for you. That is a supported way to invoice — work agreed on the
              phone still gets billed.
            </p>
          )}
        </div>

        {stage && !stage.evidenceReady ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-5 text-xs leading-relaxed">
            No photos are attached to {stage.name.toLowerCase()} yet. A draw
            lands better when she sees what was done before she is asked for
            money.
          </p>
        ) : null}

        <Button size="lg" onClick={issue} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Send />}
          Send this bill
        </Button>
      </aside>
    </div>
  );
}

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="text-muted-foreground flex justify-between gap-2 py-0.5 text-sm">
      <span>{label}</span>
      <span className="tabular-nums">{formatMoney(cents)}</span>
    </div>
  );
}
