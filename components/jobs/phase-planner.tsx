"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { MoneyInput } from "@/components/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, moneyInputValue, parseMoney } from "@/lib/quote";
import { phaseGateValues, type PhaseGate } from "@/lib/schemas";

/** When a phase's money is due, in the contractor's words. */
export const PHASE_GATE_LABEL: Record<PhaseGate, string> = {
  on_acceptance: "When they accept (deposit)",
  phase_complete: "When the phase is done",
  inspection_passed: "When the inspection passes",
  on_completion: "When the job is finished",
};

type PlannedPhase = {
  id: string;
  name: string;
  amountCents: number;
  gate: PhaseGate;
  billed: boolean;
  /** The parts of the job it was agreed to cover — "Bedroom 1, Bedroom 2". */
  covers?: string | null;
};

type Row = {
  key: string;
  id?: string;
  name: string;
  amount: string;
  gate: PhaseGate;
  billed: boolean;
  covers?: string | null;
};

let rowSeed = 0;
const newKey = () => `new-${++rowSeed}`;

function toRows(phases: PlannedPhase[]): Row[] {
  return phases.map((phase) => ({
    key: phase.id,
    id: phase.id,
    name: phase.name,
    amount: moneyInputValue(phase.amountCents),
    gate: phase.gate,
    billed: phase.billed,
    covers: phase.covers ?? null,
  }));
}

/**
 * How this job gets paid, stage by stage — the plan every phase, draw and
 * "mark complete" reads.
 *
 * **One row per payment**: a deposit, a draw as each phase finishes, and the
 * final balance. A billed row keeps its name editable and locks the rest,
 * because its amount is on an invoice the customer already has.
 *
 * The running total sits beside Save and turns red past the agreed total —
 * the server refuses that too, but the contractor should see it coming.
 */
export function PhasePlanner({
  jobId,
  agreedCents,
  phases,
}: {
  jobId: string;
  agreedCents: number;
  phases: PlannedPhase[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [rows, setRows] = useState<Row[]>(() =>
    phases.length
      ? toRows(phases)
      : [
          {
            key: newKey(),
            name: "",
            amount: "",
            gate: "on_acceptance",
            billed: false,
          },
        ]
  );

  const plannedCents = rows.reduce(
    (sum, row) => sum + (parseMoney(row.amount) ?? 0),
    0
  );
  const over = agreedCents > 0 && plannedCents > agreedCents;
  const unnamed = rows.some((row) => !row.name.trim());

  function change(key: string, fields: Partial<Row>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...fields } : row))
    );
    setDirty(true);
  }

  function add() {
    setRows((current) => [
      ...current,
      {
        key: newKey(),
        name: "",
        amount: "",
        gate: current.length === 0 ? "on_acceptance" : "phase_complete",
        billed: false,
      },
    ]);
    setDirty(true);
  }

  function remove(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
    setDirty(true);
  }

  function save() {
    startTransition(async () => {
      const response = await fetch(`/api/v1/jobs/${jobId}/phases`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phases: rows.map((row) => ({
            id: row.id,
            name: row.name.trim(),
            amountCents: parseMoney(row.amount) ?? 0,
            gate: row.gate,
          })),
        }),
      }).catch(() => null);

      const body = (await response?.json().catch(() => null)) as {
        data?: {
          phases: {
            id: string;
            name: string;
            amountCents: number;
            gate: PhaseGate;
            invoiceId: string | null;
          }[];
        };
        error?: { message?: string };
      } | null;

      if (!response?.ok || !body?.data) {
        toast.error(
          body?.error?.message ??
            "Couldn't reach the server, so the phases weren't saved. Try again."
        );
        return;
      }

      // The saved rows carry ids now. Keeping the old ones would make the next
      // save add every new phase a second time.
      setRows(
        toRows(
          body.data.phases.map((phase) => ({
            ...phase,
            billed: phase.invoiceId !== null,
            // What a phase covers comes from the contract, not the save.
            covers: phases.find((planned) => planned.id === phase.id)?.covers ?? null,
          }))
        )
      );
      setDirty(false);
      toast.success("Phases saved.");
      router.refresh();
    });
  }

  return (
    <section id="phases" className="flex scroll-mt-20 flex-col gap-4 rounded-xl border p-5">
      <div>
        <h2 className="font-label text-[11px] uppercase">
          How this job gets paid
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          One row per payment — a deposit, a draw as each phase finishes, and the
          final balance. Each phase is marked complete with photos and a
          write-up before it&apos;s billed.
        </p>
      </div>

      {rows.length ? (
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div
              key={row.key}
              className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_15rem_2.25rem]"
            >
              <Input
                aria-label={`Phase ${index + 1} name`}
                placeholder="Phase name"
                value={row.name}
                onChange={(event) => change(row.key, { name: event.target.value })}
              />
              <MoneyInput
                aria-label={`Phase ${index + 1} amount`}
                placeholder="0.00"
                value={row.amount}
                disabled={row.billed}
                onChange={(event) =>
                  change(row.key, { amount: event.target.value })
                }
              />
              <Select
                value={row.gate}
                disabled={row.billed}
                onValueChange={(value) =>
                  change(row.key, { gate: value as PhaseGate })
                }
              >
                <SelectTrigger
                  aria-label={`Phase ${index + 1} is due`}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {phaseGateValues.map((gate) => (
                    <SelectItem key={gate} value={gate}>
                      {PHASE_GATE_LABEL[gate]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove phase ${index + 1}`}
                disabled={row.billed}
                onClick={() => remove(row.key)}
              >
                <Trash2 />
              </Button>
              {row.covers ? (
                <p className="text-muted-foreground -mt-1 text-xs sm:col-span-4">
                  Covers {row.covers}
                </p>
              ) : null}
              {row.billed ? (
                <p className="text-muted-foreground text-xs sm:col-span-4">
                  Billed — the amount and when it&apos;s due are on an invoice
                  now, so they&apos;re locked.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          No phases. The job will be billed without a plan.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button variant="outline" size="sm" onClick={add}>
          <Plus />
          Add a phase
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <p
            className={
              over ? "text-destructive text-sm" : "text-muted-foreground text-sm"
            }
          >
            {agreedCents > 0
              ? `${formatMoney(plannedCents)} of ${formatMoney(agreedCents)} agreed${
                  over ? " — more than was agreed" : ""
                }`
              : `${formatMoney(plannedCents)} planned`}
          </p>
          <Button
            size="sm"
            onClick={save}
            disabled={pending || !dirty || over || unnamed}
          >
            {pending ? "Saving..." : "Save phases"}
          </Button>
        </div>
      </div>
    </section>
  );
}
