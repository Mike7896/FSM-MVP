"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import {
  baseTotal,
  formatMoney,
  isText,
  newPhaseKey,
  paymentPlan,
  percentOf,
  phaseKeyOf,
  termsSentence,
  totals,
  type PhaseSplit,
  type QuoteDraft,
  type QuotePhase,
  type QuoteTerms,
} from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * Four picks for a thumb, and the typed field for anything else (5b).
 *
 * **None is picked for him.** A deposit switched on starts empty, and one pick
 * is marked recommended — highlighted, never selected — so there is somewhere
 * for the eye to land without a number arriving on the quote he didn't choose.
 */
const DEPOSIT_PICKS = [10, 25, 30, 50] as const;
const RECOMMENDED_DEPOSIT = 30;

/** Which top-level row is billed in which phase, by the row's key. */
export type PhaseAssignments = Map<string, string | null>;

/**
 * How you get paid — **confirm, not configure**, until he bills in phases.
 *
 * The primary action says "Confirm and keep going" because the terms are
 * already correct: they arrive pre-filled as normal trade practice and the
 * contractor's job here is to glance and continue. The anxiety it fights is
 * looking greedy, which is why the homeowner's exact wording sits on the same
 * screen — a contractor who can read the sentence she will read stops worrying
 * about how the ask lands.
 *
 * **Billing in phases is set up here, on the quote**, because she is agreeing
 * to how she pays as well as what: each phase, the part of the job it covers,
 * and what it bills when it's done are on the quote she accepts (Mike, Oct 4
 * 2026). Split by the work, a phase bills what its rows are worth; split by
 * percent, it bills a share — for rough-in and trim, where the same rows run
 * through every phase.
 *
 * **Two switches drive five model fields.** The Object Model holds money up
 * front, billing trigger and progress billing as separate decisions, and it is
 * right to: they vary independently on a commercial job. But a contractor
 * writing a $3,500 panel swap is making one decision — *do I take a deposit,
 * and do I bill in stages* — so the mapping lives here, in the interface, and
 * the model stays fully expressive underneath for the preset that needs it.
 */
export function TermsSheet({
  open,
  onOpenChange,
  draft,
  customerName,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: QuoteDraft;
  customerName: string;
  onChange: (terms: QuoteTerms, phases: PhaseAssignments) => void;
}) {
  // Seeded once per opening. The caller mounts this only while it is open, so
  // a fresh mount is the re-seed — which keeps it from ever showing a stale
  // copy of terms changed elsewhere (a preset applied, a change order
  // inheriting from its contract) without an effect to synchronise.
  const [terms, setTerms] = useState<QuoteTerms>(draft.terms);
  const [assigned, setAssigned] = useState<PhaseAssignments>(
    () => new Map(draft.scope.map((node) => [node.key, node.phaseKey ?? null]))
  );

  const firstName = customerName.trim().split(/\s+/)[0] || "Your customer";

  // Previewed against the live lines, so the numbers move as he changes the
  // percentage or moves a room rather than after he confirms.
  const scope = draft.scope.map((node) => ({
    ...node,
    phaseKey: assigned.get(node.key) ?? null,
  }));
  const previewDraft = { ...draft, terms, scope };
  const preview = totals(previewDraft);
  const plan = paymentPlan(previewDraft, preview);
  const depositOn = terms.moneyUpFront === "deposit";
  const stagesOn = terms.progressBilling === "draws";
  const depositCents = depositOn
    ? percentOf(preview.totalCents, terms.depositPercent ?? 0)
    : 0;

  function confirm() {
    onChange(terms, assigned);
    onOpenChange(false);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-2xl">
        <ResponsiveDialogHeader
          title="How you get paid"
          description={`Your call on each of these. ${firstName} sees them in plain language.`}
        />

        <ResponsiveDialogBody className="flex flex-col gap-5">
          <section className="rounded-xl border p-5">
            <div className="flex items-center justify-between gap-4">
              <Label
                htmlFor="deposit-on"
                className="font-label text-[11px] uppercase"
              >
                Deposit
              </Label>
              <Switch
                id="deposit-on"
                checked={depositOn}
                onCheckedChange={(on) =>
                  setTerms({
                    ...terms,
                    moneyUpFront: on ? "deposit" : "none",
                    // Null rather than 0: "no deposit" and "a 0% deposit" are
                    // the same money and different intentions, and the terms
                    // sentence needs to tell them apart. Switched on, it starts
                    // empty — the percentage is his to set, not ours to guess.
                    depositPercent: on ? terms.depositPercent : null,
                  })
                }
              />
            </div>

            {depositOn ? (
              <div className="mt-4 grid grid-cols-4 items-start gap-2">
                {DEPOSIT_PICKS.map((percent) => {
                  const selected = terms.depositPercent === percent;
                  const recommended = percent === RECOMMENDED_DEPOSIT;
                  return (
                    <div
                      key={percent}
                      className="flex flex-col items-center gap-1"
                    >
                      <Button
                        type="button"
                        variant={selected ? "default" : "outline"}
                        aria-pressed={selected}
                        className={cn(
                          "w-full tabular-nums",
                          recommended &&
                            !selected &&
                            "border-primary text-primary-ink"
                        )}
                        onClick={() =>
                          setTerms({ ...terms, depositPercent: percent })
                        }
                      >
                        {percent}%
                      </Button>
                      {recommended ? (
                        <span className="text-primary-ink font-label text-[10px] uppercase">
                          Recommended
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {depositOn ? (
              <p className="mt-3 text-sm leading-relaxed">
                {firstName} pays{" "}
                <span className="inline-flex items-baseline gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={terms.depositPercent ?? ""}
                    onChange={(event) =>
                      setTerms({
                        ...terms,
                        depositPercent:
                          event.target.value === ""
                            ? null
                            : Math.max(
                                0,
                                Math.min(100, Math.round(Number(event.target.value)) || 0)
                              ),
                      })
                    }
                    className="h-8 w-16 text-center font-medium"
                    aria-label="Deposit percentage"
                  />
                  <span className="font-medium">%</span>
                </span>{" "}
                — <strong className="font-semibold">{formatMoney(depositCents)}</strong>{" "}
                — when she accepts. Card comes out automatically.
              </p>
            ) : (
              <p className="text-muted-foreground mt-3 text-sm">
                No money up front. You&apos;ll invoice the full amount when the
                work&apos;s done.
              </p>
            )}
          </section>

          <section className="rounded-xl border p-5">
            <div className="flex items-center justify-between gap-4">
              <Label
                htmlFor="progress-on"
                className="font-label text-[11px] uppercase"
              >
                Progress billing
              </Label>
              <Switch
                id="progress-on"
                checked={stagesOn}
                onCheckedChange={(on) =>
                  setTerms({
                    ...terms,
                    progressBilling: on ? "draws" : "single_final_invoice",
                    billingTrigger: on ? "on_milestone" : "on_completion",
                  })
                }
              />
            </div>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              Bill each part of the job when it&apos;s done, so you&apos;re not
              funding the work out of pocket. {firstName} sees every phase, what
              it covers and what it bills, before accepting.
            </p>

            {stagesOn ? (
              <PhaseBuilder
                draft={previewDraft}
                plan={plan}
                onTerms={(patch) => setTerms({ ...terms, ...patch })}
                onAssign={(key, phaseKey) =>
                  setAssigned((current) => new Map(current).set(key, phaseKey))
                }
                onAssignAll={(next) =>
                  setAssigned((current) => {
                    const merged = new Map(current);
                    next.forEach((phaseKey, key) => merged.set(key, phaseKey));
                    return merged;
                  })
                }
              />
            ) : null}
          </section>

          {!stagesOn ? (
            <section className="rounded-xl border p-5">
              <p className="font-label text-[11px] uppercase">
                Balance
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                <strong className="font-semibold">
                  {formatMoney(preview.totalCents - depositCents)}
                </strong>{" "}
                due when the work&apos;s done and inspected. Invoice sends
                itself.
              </p>
            </section>
          ) : null}

          {/* The same commitment in her register. He sees the mechanism above;
              she meets the consequence. */}
          <section className="bg-muted/40 rounded-xl border p-5">
            <p className="text-muted-foreground font-label text-[10px] uppercase">
              What {firstName} reads
            </p>
            <p className="mt-2 text-sm leading-relaxed italic">
              &ldquo;{termsSentence(previewDraft, preview)}&rdquo;
            </p>
            {plan.length > 1 ? (
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {plan.map((payment, index) => (
                  <li
                    key={payment.phaseKey ?? `${payment.name}-${index}`}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="min-w-0">{payment.name}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatMoney(payment.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          {/* A deposit switched on with no percentage is a question, not an
              answer — confirming it would send a deposit of nothing. */}
          <Button
            size="lg"
            className="w-full"
            onClick={confirm}
            disabled={depositOn && terms.depositPercent === null}
          >
            Confirm and keep going
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

const SPLITS: { value: PhaseSplit; label: string; blurb: string }[] = [
  {
    value: "scope",
    label: "By the work",
    blurb: "Each phase bills what its part of the job is worth — a floor, a room.",
  },
  {
    value: "percent",
    label: "By percent",
    blurb:
      "Each phase bills a share of what's left after the deposit — for rough-in and trim, where the same work runs through every phase.",
  },
];

/**
 * The phases, and which part of the job each one covers.
 *
 * **The rows are listed once, each with its phase**, rather than each phase
 * listing every row to tick: a room belongs to exactly one phase, and a list
 * of checkboxes per phase is a way to put it in two or in none.
 */
function PhaseBuilder({
  draft,
  plan,
  onTerms,
  onAssign,
  onAssignAll,
}: {
  draft: QuoteDraft;
  plan: ReturnType<typeof paymentPlan>;
  onTerms: (patch: Partial<QuoteTerms>) => void;
  onAssign: (key: string, phaseKey: string | null) => void;
  onAssignAll: (next: PhaseAssignments) => void;
}) {
  const { phases, phaseSplit } = draft.terms;
  const byScope = phaseSplit === "scope";
  // The parts of the job a phase can cover: priced top-level rows. Optional
  // rows aren't in the price, and notes carry no money to bill.
  const parts = draft.scope.filter((node) => !isText(node) && !node.optional);

  function setPhases(next: QuotePhase[]) {
    onTerms({ phases: next });
  }

  function rename(key: string, name: string) {
    setPhases(phases.map((phase) => (phase.key === key ? { ...phase, name } : phase)));
  }

  function add() {
    setPhases([...phases, { key: newPhaseKey(), name: "", percent: 0 }]);
  }

  function remove(key: string) {
    setPhases(phases.filter((phase) => phase.key !== key));
    // Its rows fall to the last phase, the same as any row with no phase.
    const freed: PhaseAssignments = new Map();
    for (const node of draft.scope) {
      if (node.phaseKey === key) freed.set(node.key, null);
    }
    if (freed.size) onAssignAll(freed);
  }

  /** A phase per part of the job, named after it — the rooms, in order. */
  function onePerPart() {
    const made = parts.map((node) => ({
      key: newPhaseKey(),
      name: node.description.trim(),
      percent: 0,
    }));
    setPhases(made);
    onAssignAll(new Map(parts.map((node, index) => [node.key, made[index].key])));
  }

  function split(next: PhaseSplit) {
    // Percentages starting at nothing would bill everything in the last phase;
    // an even split is the neutral start, and every one is his to change.
    const even =
      next === "percent" && phases.length > 0 && phases.every((phase) => !phase.percent);
    onTerms({
      phaseSplit: next,
      ...(even
        ? {
            phases: phases.map((phase) => ({
              ...phase,
              percent: Math.round((100 / phases.length) * 10) / 10,
            })),
          }
        : {}),
    });
  }

  const billed = (key: string) => plan.find((payment) => payment.phaseKey === key);

  return (
    <div className="mt-5 flex flex-col gap-5 border-t pt-5">
      <div>
        <p className="text-muted-foreground font-label mb-2 text-[10px] uppercase">
          Split the price
        </p>
        <div className="grid grid-cols-2 gap-2">
          {SPLITS.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={phaseSplit === option.value ? "default" : "outline"}
              aria-pressed={phaseSplit === option.value}
              onClick={() => split(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
          {SPLITS.find((option) => option.value === phaseSplit)?.blurb}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground font-label text-[10px] uppercase">
          Phases
        </p>
        {phases.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            No phases yet. Add one for each stage the work happens in — until
            then the balance is one invoice at the end.
          </p>
        ) : (
          phases.map((phase, index) => {
            const payment = billed(phase.key);
            const work = payment?.workCents ?? null;
            return (
              <div
                key={phase.key}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto_2rem] items-center gap-2"
              >
                <span className="text-muted-foreground text-center text-sm tabular-nums">
                  {index + 1}
                </span>
                <Input
                  value={phase.name}
                  onChange={(event) => rename(phase.key, event.target.value)}
                  aria-label={`Phase ${index + 1} name`}
                  placeholder={`Phase ${index + 1}`}
                />
                <div className="flex items-center gap-2">
                  {byScope ? null : (
                    <span className="inline-flex items-baseline gap-1">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={phase.percent || ""}
                        onChange={(event) =>
                          setPhases(
                            phases.map((candidate) =>
                              candidate.key === phase.key
                                ? {
                                    ...candidate,
                                    percent: Math.max(
                                      0,
                                      Math.min(100, Number(event.target.value) || 0)
                                    ),
                                  }
                                : candidate
                            )
                          )
                        }
                        className="h-9 w-16 text-center"
                        aria-label={`Phase ${index + 1} percent`}
                      />
                      <span className="text-sm">%</span>
                    </span>
                  )}
                  <span className="w-24 text-right">
                    <span className="block text-sm font-medium tabular-nums">
                      {formatMoney(payment?.amountCents ?? 0)}
                    </span>
                    {work !== null && work !== payment?.amountCents ? (
                      <span className="text-muted-foreground block text-[11px] tabular-nums">
                        of {formatMoney(work)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Remove phase ${index + 1}`}
                  onClick={() => remove(phase.key)}
                >
                  <X />
                </Button>
              </div>
            );
          })
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus />
            Add a phase
          </Button>
          {byScope && phases.length === 0 && parts.length > 1 ? (
            <Button type="button" variant="ghost" size="sm" onClick={onePerPart}>
              One phase for each part of the job
            </Button>
          ) : null}
        </div>
        {phases.length > 0 && plan[0]?.phaseKey === null && plan[0].gate === "on_acceptance" ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            Amounts are what each phase bills, after the deposit.
          </p>
        ) : null}
      </div>

      {byScope && phases.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground font-label text-[10px] uppercase">
            What each phase covers
          </p>
          {parts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing priced in the scope yet.
            </p>
          ) : (
            parts.map((node) => (
              <div
                key={node.key}
                className="grid grid-cols-[minmax(0,1fr)_auto_minmax(8rem,12rem)] items-center gap-3"
              >
                <span className="min-w-0 truncate text-sm">
                  {node.description.trim() || "Untitled row"}
                </span>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {formatMoney(baseTotal(node))}
                </span>
                <Select
                  value={phaseKeyOf(node, phases) ?? undefined}
                  onValueChange={(value) => onAssign(node.key, value)}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={`Phase for ${node.description.trim() || "this row"}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {phases.map((phase, index) => (
                      <SelectItem key={phase.key} value={phase.key}>
                        {phase.name.trim()
                          ? `${index + 1} · ${phase.name.trim()}`
                          : `Phase ${index + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))
          )}
          <p className="text-muted-foreground text-xs leading-relaxed">
            A row you add later goes in the last phase until you move it.
          </p>
        </div>
      ) : null}
    </div>
  );
}
