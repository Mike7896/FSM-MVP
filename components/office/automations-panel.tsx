"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NOTIFICATION_KINDS } from "@/lib/notifications/catalog";
import { cn } from "@/lib/utils";

/**
 * Screen 43 · automations · job CF2. Wireframe 94 · 34a and 27a–b.
 *
 * **Grouped by who the automation touches**, because that is the only
 * distinction a contractor cares about. Things that appear on his own screen
 * can be quiet and on by default. Things that speak to his customer go out
 * under his name, from his number, with replies landing on him — so they need
 * preview, timing, quiet hours, and a legitimate *draft it, don't send it*
 * middle setting.
 *
 * **The asymmetry is the design's whole argument**, and at desk width you can
 * see it in one glance: contractor-facing rows stay switches and never populate
 * the preview pane, because there is nothing to preview when only he sees it.
 *
 * **The preview stops being a destination.** On a phone, "see what they'd
 * receive" is a screen you go to and come back from. Here it is the right pane,
 * always populated by whichever customer-facing automation is selected, so
 * changing the timing and reading the message become one continuous act.
 *
 * **The preview is the template, not a made-up message.** It carries the
 * shop's own name, and every part that depends on the job — who it goes to, the
 * link, the phase — stays a bracketed slot. An invented customer and a fake
 * link on this screen would read as something that already went out.
 *
 * **Still no master off switch.** Per-behaviour granularity at any width — one
 * bad experience must never be able to kill every automation.
 */

type SendMode = "auto" | "draft" | "off";


const SPEAKS_TO_CUSTOMERS = [
  {
    id: "followup",
    label: "Following up on a quote",
    timing: "If they haven't answered in 3 days",
    mode: "auto" as SendMode,
    subject: "Quote follow-up, as a text",
    body: (business: string) =>
      `Hi [first name] — ${business} here. Just checking the quote made sense. Happy to walk through any of it. Here it is again: [quote link]`,
    channel: "Text",
    waitDays: "3 days",
    repeat: "Never",
  },
  {
    id: "chase",
    label: "Chasing an unpaid invoice",
    timing: "Day 3, 7 and 14",
    mode: "auto" as SendMode,
    subject: "Invoice reminder, as an email",
    body: (business: string) =>
      `Hi [first name] — the invoice from ${business} for [the job] is still open. You can pay it on the same link you approved the quote with: [invoice link]. Any questions, just reply here.`,
    channel: "Email",
    waitDays: "3 days",
    repeat: "Day 7, then day 14",
  },
  {
    id: "evidence",
    label: "Asking for approval on finished work",
    timing: "When you submit phase evidence",
    mode: "auto" as SendMode,
    subject: "Phase complete, as a text",
    body: (business: string) =>
      `Hi [first name] — ${business} here. [Phase] is done. Photos and the write-up are here, along with what's due for this stage: [link]`,
    channel: "Text",
    waitDays: "Straight away",
    repeat: "Never",
  },
];

const ALWAYS_ON = {
  label: "Receipts after a payment",
  timing: "Immediately · can't be turned off",
};

export function AutomationsPanel({
  businessName,
}: {
  /** The shop's own name, as its documents carry it. Null until it's set. */
  businessName: string | null;
}) {
  const [selected, setSelected] = useState(SPEAKS_TO_CUSTOMERS[0].id);
  const [modes, setModes] = useState<Record<string, SendMode>>(
    Object.fromEntries(SPEAKS_TO_CUSTOMERS.map((row) => [row.id, row.mode]))
  );

  const preview = SPEAKS_TO_CUSTOMERS.find((row) => row.id === selected)!;
  const business = businessName ?? "[your business name]";

  return (
    <div className="grid min-w-0 items-start gap-6 @3xl/office:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-6">
        {/* Contractor-facing. These are the notifications, and they are each
            person's own — so they are chosen in Settings, where the person
            is, and only listed here so the Office's whole picture of "what
            the app does without me" is on one page. */}
        <section className="rounded-xl border p-5">
          <p className="font-label text-[11px] uppercase">
            Tells me things
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Only you see these — in the app&apos;s bell, and by email or text
            if you choose. Each person on the team picks their own.
          </p>

          <ul className="mt-4 flex flex-col">
            {NOTIFICATION_KINDS.map((item) => (
              <li key={item.kind} className="border-t py-3 text-sm">
                {item.label}
              </li>
            ))}
          </ul>

          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link href="/settings#notifications">
              Choose what reaches you, and how
            </Link>
          </Button>
        </section>

        {/* Customer-facing. These use his name and his relationship, so every
            one of them is selectable and previewable, and every one has a
            draft-it-for-me middle setting. */}
        <section className="border-primary/60 rounded-xl border p-5">
          <p className="font-label text-[11px] uppercase">
            Speaks to my customers
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            These go out with{" "}
            <strong className="text-foreground font-medium">your</strong> name on
            them. Pick one to see what it says.
          </p>

          <div className="mt-4 flex flex-col gap-2">
            {/* Two controls per row, side by side rather than nested: one
                chooses what the preview shows, the other chooses how the thing
                sends. They were briefly one, which put the mode buttons inside
                the selection button — invalid HTML, and it also conflated
                "show me this" with "change this". */}
            {SPEAKS_TO_CUSTOMERS.map((row) => (
              <div
                key={row.id}
                className={cn(
                  "rounded-lg border p-3.5 transition-colors",
                  selected === row.id
                    ? "border-primary bg-primary/[0.03]"
                    : "hover:bg-muted/50"
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelected(row.id)}
                  aria-pressed={selected === row.id}
                  className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left"
                >
                  <span className="text-sm font-medium">{row.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {row.timing}
                  </span>
                </button>

                <ModePicker
                  className="mt-2.5"
                  value={modes[row.id]}
                  // Changing a mode also brings that row's message up, so the
                  // contractor is never editing the timing of one automation
                  // while reading the words of another.
                  onChange={(mode) => {
                    setSelected(row.id);
                    setModes((current) => ({ ...current, [row.id]: mode }));
                  }}
                  label={row.label}
                />
              </div>
            ))}

            {/* One row nobody may switch off, and it says why rather than
                appearing as a disabled control with no explanation. */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3.5">
              <div>
                <p className="text-sm font-medium">{ALWAYS_ON.label}</p>
                <p className="text-muted-foreground text-xs">
                  {ALWAYS_ON.timing}
                </p>
              </div>
              <Badge variant="secondary">Always</Badge>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4 border-t pt-4">
            <div>
              <Label htmlFor="quiet" className="font-normal">
                Quiet hours
              </Label>
              <p className="text-muted-foreground mt-1 text-xs">
                Nothing goes to a customer outside working hours
              </p>
            </div>
            <Switch id="quiet" defaultChecked />
          </div>
        </section>
      </div>

      <aside className="flex min-w-0 flex-col gap-2 @3xl/office:sticky @3xl/office:top-22 @3xl/office:self-start">
        <p className="text-muted-foreground font-label text-[10px] uppercase">
          What your customer would get
        </p>

        <div className="rounded-xl border">
          <div className="border-b px-4 py-2.5">
            <span className="text-xs font-medium">{preview.subject}</span>
          </div>

          <p className="px-4 py-4 text-sm leading-relaxed">
            {preview.body(business)}
          </p>

          <p className="text-muted-foreground border-t px-4 py-2.5 text-xs">
            From your business number. Replies come to you, not us.
          </p>
        </div>

        <div className="rounded-xl border">
          <PreviewRow label="Wait after sending" value={preview.waitDays} />
          <PreviewRow label="Follow up again" value={preview.repeat} />
          <PreviewRow label="Channel" value={preview.channel} />
        </div>

        <p className="text-muted-foreground text-xs leading-relaxed">
          The parts in brackets come from the job it&apos;s about. Wording
          changes with the situation — someone who opened it twice gets a
          different message than someone who never opened it.
        </p>
      </aside>
    </div>
  );
}

/**
 * Three send modes, not a switch.
 *
 * **Draft-it-for-me is the most-used setting, and probably the point of the
 * feature**: the value is not having to write the follow-up, not having it sent
 * unseen. It hands off to the dashboard's *waiting on customer* row.
 */
function ModePicker({
  value,
  onChange,
  label,
  className,
}: {
  value: SendMode;
  onChange: (mode: SendMode) => void;
  label: string;
  className?: string;
}) {
  const options: Array<{ id: SendMode; text: string }> = [
    { id: "auto", text: "Sends itself" },
    { id: "draft", text: "Draft it for me" },
    { id: "off", text: "Off" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={`${label} — how it sends`}
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded-md border px-2.5 py-1 font-label text-[10px] uppercase transition-colors",
            value === option.id
              ? "border-primary bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
