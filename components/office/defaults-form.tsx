"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { SaveBar } from "@/components/save-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { normalizePreset } from "@/lib/branding";
import { formatMoney, moneyInputValue, parseMoney } from "@/lib/quote";
import type { OfficeDefaultsRow } from "@/lib/queries/office";

/**
 * Screen 41 · money and scope defaults · job CF1.
 *
 * **A default is a starting value**, and that is the notice this page exists to
 * make believable. Changing one applies to the next quote; anything already
 * created, and anything already sent, stays exactly as it is. It is the first
 * question a contractor asks before touching any of these, and it is true
 * structurally rather than by promise — the endpoint behind this form has no
 * path to `quotes`.
 *
 * **Every field can be empty, and empty is a real answer.** A shop that has not
 * set a tax rate is not a shop with a 0% rate: the editor needs to tell those
 * apart so it knows whether to ask. So a cleared field stores null and the
 * placeholder says what happens if it stays that way, rather than a zero
 * quietly becoming a decision nobody made.
 *
 * **No example wording.** The text boxes start empty rather than showing
 * someone else's exclusions and terms in grey — sample lines on the page where
 * he writes his own read as a suggestion of what his should say.
 *
 * The form holds **what a contractor types** — "8.25", "$114", "32" — and
 * converts at the boundary to what the database stores: a decimal fraction,
 * integer cents, a number. Doing it here, once, is what keeps a rate from being
 * 8.25 in one table and 0.0825 in another.
 */
type FormValues = {
  depositPercent: string;
  materialMarkupPercent: string;
  laborRate: string;
  taxRatePercent: string;
  quoteValidityDays: string;
  drawPattern: Array<{ name: string; percent: string }>;
  standardExclusions: string;
  standardAssumptions: string;
  standardTerms: string;
};

export function DefaultsForm({ defaults }: { defaults: OfficeDefaultsRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    defaultValues: {
      depositPercent: numberToInput(defaults.depositPercent),
      materialMarkupPercent: numberToInput(defaults.materialMarkupPercent),
      laborRate: moneyInputValue(defaults.laborRateCents),
      // Stored as a fraction, shown as a percentage. 0.0825 → "8.25".
      taxRatePercent:
        defaults.taxRate === null
          ? ""
          : String(Math.round(Number(defaults.taxRate) * 1_000_000) / 10_000),
      quoteValidityDays: numberToInput(defaults.quoteValidityDays),
      drawPattern: (defaults.drawPattern ?? []).map((stage) => ({
        name: stage.name,
        percent: String(stage.percent),
      })),
      standardExclusions: defaults.standardExclusions ?? "",
      standardAssumptions: defaults.standardAssumptions ?? "",
      standardTerms: defaults.standardTerms ?? "",
    },
  });

  const stages = useFieldArray({ control: form.control, name: "drawPattern" });

  // `useWatch` rather than `form.watch()`, which the React Compiler cannot
  // memoize and so skips the component over. Only the two fields whose notes
  // recompute are subscribed.
  const markup = useWatch({
    control: form.control,
    name: "materialMarkupPercent",
  });
  const laborRate = useWatch({ control: form.control, name: "laborRate" });
  const pattern = useWatch({ control: form.control, name: "drawPattern" });
  const patternTotal = (pattern ?? []).reduce(
    (sum, stage) => sum + (inputToNumber(stage?.percent ?? "") ?? 0),
    0
  );

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const response = await fetch("/api/v1/office/defaults", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          depositPercent: inputToInt(values.depositPercent),
          materialMarkupPercent: inputToNumber(values.materialMarkupPercent),
          laborRateCents: parseMoney(values.laborRate),
          taxRate: percentToFraction(values.taxRatePercent),
          quoteValidityDays: inputToInt(values.quoteValidityDays),
          drawPattern: values.drawPattern
            .filter((stage) => stage.name.trim() !== "")
            .map((stage) => ({
              name: stage.name.trim(),
              percent: inputToNumber(stage.percent) ?? 0,
            })),
          standardExclusions: values.standardExclusions.trim() || null,
          standardAssumptions: values.standardAssumptions.trim() || null,
          standardTerms: values.standardTerms.trim() || null,
          // Not shown on this page — document branding is its own destination,
          // and echoing the stored value back is what stops saving here from
          // silently resetting it.
          documentPreset: normalizePreset(defaults.documentPreset),
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        form.setError("root", {
          message: body?.error?.message ?? "Couldn't save. Try again.",
        });
        return;
      }

      toast.success("Saved. Your next quote starts from these.");
      form.reset(values);
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} className="w-full max-w-6xl flex min-w-0 flex-col gap-6">
      {/* The retroactivity question, answered before it is asked — and it
          stays a full-width banner at every size, never demoted to a column
          heading. It is the same sentence the editor says at the moment of
          correction. */}
      <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm leading-relaxed">
        <strong className="text-foreground font-medium">
          These apply to new quotes.
        </strong>{" "}
        Nothing you&apos;ve already created or sent will change.
      </p>

      <div className="grid min-w-0 items-start gap-6 @4xl/office:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
      <section className="@container/defaults flex min-w-0 flex-col gap-6 rounded-xl border p-5 sm:p-6 [&_input]:h-10">
        <p className="text-base font-semibold tracking-tight">
          Money
        </p>

        <div className="grid gap-4 @sm/defaults:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="depositPercent">Deposit</Label>
            <Suffixed suffix="%">
              <Input
                id="depositPercent"
                inputMode="decimal"
                placeholder="None"
                className="pr-8 text-right tabular-nums"
                {...form.register("depositPercent")}
              />
            </Suffixed>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Leave it empty to ask for nothing up front.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="materialMarkupPercent">Material markup</Label>
            <Suffixed suffix="%">
              <Input
                id="materialMarkupPercent"
                inputMode="decimal"
                placeholder="None"
                className="pr-8 text-right tabular-nums"
                {...form.register("materialMarkupPercent")}
              />
            </Suffixed>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {/* Markup and margin are different numbers and contractors get
                  burned on the difference. Stating both is the whole point of
                  the line. */}
              {marginNote(markup)}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="taxRatePercent">Tax rate</Label>
            <Suffixed suffix="%">
              <Input
                id="taxRatePercent"
                inputMode="decimal"
                placeholder="None"
                className="pr-8 text-right tabular-nums"
                {...form.register("taxRatePercent")}
              />
            </Suffixed>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Charged on materials, not on labor.
            </p>
          </div>
        </div>

        <div className="grid gap-4 @sm/defaults:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="laborRate">Labor rate</Label>
            <Prefixed prefix="$">
              <Input
                id="laborRate"
                inputMode="decimal"
                placeholder="None"
                className="pr-14 pl-6 text-right tabular-nums"
                {...form.register("laborRate")}
              />
              <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm">
                /hr
              </span>
            </Prefixed>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {laborNote(laborRate)}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="quoteValidityDays">Quote good for</Label>
            <Suffixed suffix="days">
              <Input
                id="quoteValidityDays"
                inputMode="numeric"
                placeholder="No limit"
                className="pr-14 text-right tabular-nums"
                {...form.register("quoteValidityDays")}
              />
            </Suffixed>
            <p className="text-muted-foreground text-xs leading-relaxed">
              What makes a quote an offer that expires rather than one held open.
            </p>
          </div>
        </div>
      </section>

      {/* Draws — a pattern, not a schedule. There is no job behind it and no
          amounts in it, which is exactly why it can live in the Office at all:
          a Job's own draw schedule is where percentages meet a price. */}
      <section className="@container/defaults flex min-w-0 flex-col gap-6 rounded-xl border p-5 sm:p-6 [&_input]:h-10">
        <div>
          <p className="text-base font-semibold tracking-tight">
            Draws
          </p>
          <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
            How you usually split a job billed in stages. Each stage becomes a
            draw on a new quote, priced from that job&apos;s total — and every
            one of them still waits on the thing that opens it.
          </p>
        </div>

        {stages.fields.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No pattern set. New quotes bill once, at the end — after the deposit,
            if you set one.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {stages.fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 @sm/defaults:grid-cols-[minmax(0,1fr)_7rem_auto]">
                <Input
                  className="col-span-2 @sm/defaults:col-span-1"
                  aria-label={`Stage ${index + 1} name`}
                  placeholder="Stage name"
                  {...form.register(`drawPattern.${index}.name` as const)}
                />
                <Suffixed suffix="%">
                  <Input
                    aria-label={`Stage ${index + 1} percentage`}
                    inputMode="decimal"
                    placeholder="0"
                    className="w-full pr-8 text-right tabular-nums"
                    {...form.register(`drawPattern.${index}.percent` as const)}
                  />
                </Suffixed>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove stage ${index + 1}`}
                  onClick={() => stages.remove(index)}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => stages.append({ name: "", percent: "" })}
          >
            <Plus />
            Add a stage
          </Button>

          {/* Said as arithmetic he can check, and said before he saves. A
              pattern that does not add up is a job that cannot be fully
              billed, and finding that out on the last draw is expensive. */}
          {stages.fields.length ? (
            <p
              className={
                Math.abs(patternTotal - 100) < 0.01
                  ? "text-muted-foreground text-sm tabular-nums"
                  : "text-destructive text-sm tabular-nums"
              }
            >
              {patternTotal.toFixed(patternTotal % 1 ? 1 : 0)}% of the job
              {Math.abs(patternTotal - 100) < 0.01 ? "" : " — needs to be 100%"}
            </p>
          ) : null}
        </div>
      </section>

        </div>

        <div className="flex min-w-0 flex-col gap-6">
      <section className="@container/defaults flex min-w-0 flex-col gap-6 rounded-xl border p-5 sm:p-6 [&_input]:h-10">
        <div>
          <p className="text-base font-semibold tracking-tight">
            What you say on every quote
          </p>
          <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
            One per line. Each becomes its own row in a new quote&apos;s scope —
            and every one of them can be changed on a single quote without
            touching what&apos;s here. Changing it there never changes this.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="standardExclusions">Standard exclusions</Label>
          <Textarea
            id="standardExclusions"
            rows={4}
            {...form.register("standardExclusions")}
          />
          <p className="text-muted-foreground text-xs leading-relaxed">
            What the price doesn&apos;t cover. This is the mechanism by which
            excluded work doesn&apos;t become free work.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="standardAssumptions">Standard assumptions</Label>
          <Textarea
            id="standardAssumptions"
            rows={3}
            {...form.register("standardAssumptions")}
          />
          <p className="text-muted-foreground text-xs leading-relaxed">
            Conditions the price depends on. Different from an exclusion, and
            they carry the same contractual weight.
          </p>
        </div>
      </section>

      <section className="@container/defaults flex min-w-0 flex-col gap-6 rounded-xl border p-5 sm:p-6 [&_input]:h-10">
        <div>
          <p className="text-base font-semibold tracking-tight">
            Terms
          </p>
          <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
            {/* The other half of a document's terms is generated from the five
                pricing decisions and restated live in the editor, which is why
                it is not here — this is only what you say on every job. */}
            What you say on every job, whatever it costs. The part that depends
            on how a job is priced — firm, capped, billed at actuals — is
            written for you from the decisions on that quote.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="standardTerms">Standard terms</Label>
          <Textarea
            id="standardTerms"
            rows={5}
            {...form.register("standardTerms")}
          />
          <p className="text-muted-foreground text-xs leading-relaxed">
            Your customer reads this on the quote and agrees to it on the
            contract, so write it the way you would say it to her.
          </p>
        </div>
      </section>

        </div>
      </div>

      <SaveBar
        dirty={form.formState.isDirty}
        pending={pending}
        error={form.formState.errors.root?.message}
      />
    </form>
  );
}

/* ── Conversions, all in one place ────────────────────────────────────── */

function numberToInput(value: string | number | null): string {
  if (value === null) return "";
  return String(value);
}

function inputToInt(value: string): number | null {
  const trimmed = value.trim().replace(/[^0-9.\-]/g, "");
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function inputToNumber(value: string): number | null {
  const trimmed = value.trim().replace(/[^0-9.\-]/g, "");
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** "8.25" → 0.0825. Rounded to the column's four decimal places. */
function percentToFraction(value: string): number | null {
  const percent = inputToNumber(value);
  if (percent === null) return null;
  return Math.round((percent / 100) * 10_000) / 10_000;
}

/**
 * Markup and margin are different numbers, and the gap between them is where a
 * contractor loses money: 32% markup is 24.2% margin, not 32%.
 */
function marginNote(markup: string): string {
  const percent = inputToNumber(markup);
  if (percent === null || percent <= 0) return "What you add on top of cost.";
  const margin = (percent / (100 + percent)) * 100;
  return `${percent}% markup is ${margin.toFixed(1)}% margin.`;
}

function laborNote(rate: string): string {
  const cents = parseMoney(rate);
  if (cents === null || cents === 0) {
    return "What a drafted labor line starts at.";
  }
  return `A drafted 8-hour day starts at ${formatMoney(cents * 8)}.`;
}

function Suffixed({
  suffix,
  children,
}: {
  suffix: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      {children}
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm">
        {suffix}
      </span>
    </div>
  );
}

function Prefixed({
  prefix,
  children,
}: {
  prefix: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm">
        {prefix}
      </span>
      {children}
    </div>
  );
}
