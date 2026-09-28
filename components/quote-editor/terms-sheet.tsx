"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import {
  formatMoney,
  percentOf,
  termsSentence,
  totals,
  type QuoteDraft,
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

/**
 * How you get paid — **confirm, not configure.**
 *
 * The primary action says "Confirm and keep going" because the terms are
 * already correct: they arrive pre-filled as normal trade practice and the
 * contractor's job here is to glance and continue. The anxiety it fights is
 * looking greedy, which is why the homeowner's exact wording sits on the same
 * screen — a contractor who can read the sentence she will read stops worrying
 * about how the ask lands.
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
  onChange: (terms: QuoteTerms) => void;
}) {
  // Seeded once per opening. The caller mounts this only while it is open, so
  // a fresh mount is the re-seed — which keeps it from ever showing a stale
  // copy of terms changed elsewhere (a preset applied, a change order
  // inheriting from its contract) without an effect to synchronise.
  const [terms, setTerms] = useState<QuoteTerms>(draft.terms);

  const firstName = customerName.trim().split(/\s+/)[0] || "Your customer";

  // Previewed against the live lines, so the numbers move as he changes the
  // percentage rather than after he confirms.
  const preview = totals({ ...draft, terms });
  const depositOn = terms.moneyUpFront === "deposit";
  const stagesOn = terms.progressBilling === "draws";
  const depositCents = depositOn
    ? percentOf(preview.totalCents, terms.depositPercent ?? 0)
    : 0;

  function confirm() {
    onChange(terms);
    onOpenChange(false);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-xl">
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
              Bill in stages as the work gets done, so you&apos;re not funding
              the job out of pocket.
            </p>
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
              &ldquo;{termsSentence({ ...draft, terms }, preview)}&rdquo;
            </p>
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
