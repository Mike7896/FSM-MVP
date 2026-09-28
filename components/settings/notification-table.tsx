"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ComingSoon } from "@/components/coming-soon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type {
  NotificationChannel,
  NotificationKind,
  NotificationPreference,
  NotificationSettings,
} from "@/lib/notifications/catalog";
import { formatPhone, toE164 } from "@/lib/sms/phone";
import { cn } from "@/lib/utils";

/**
 * Screen 44 · what reaches me, how, and when · job CF2.
 *
 * **Distinct from the Office's automations, and the split is whose thing it
 * is.** That page is what the app does in the *business's* name; this is what
 * reaches *me* — a preference belonging to the person signed in, which is why
 * it is in Settings and that one is not.
 *
 * Two halves. The table is **which** events reach you on **which** channel;
 * the sections under it are **how** — how often email comes, where texts go,
 * the hours texts wait through, and whether the app pops things up. Everything
 * also lands in the bell whatever is ticked here: the app is where the
 * business already is, so it isn't a channel to choose.
 *
 * **Everything saves on its own, as it's changed**, and puts itself back if
 * the write fails — the screen never shows a choice that isn't the one being
 * honored. A channel this server can't deliver on is marked coming soon rather
 * than offered as boxes that do nothing.
 */

const COLUMNS: { channel: NotificationChannel; label: string }[] = [
  { channel: "email", label: "Email" },
  { channel: "sms", label: "Text" },
  { channel: "push", label: "Phone app" },
];

export function NotificationTable({
  initial,
  settings: initialSettings,
  emailAvailable,
  textsAvailable,
}: {
  initial: NotificationPreference[];
  settings: NotificationSettings;
  /** Whether this server can send email at all. */
  emailAvailable: boolean;
  /** Whether this server can send a text at all. */
  textsAvailable: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [settings, setSettings] = useState(initialSettings);

  const hasNumber = Boolean(settings.smsPhone);
  const usable: Record<NotificationChannel, boolean> = {
    email: true,
    sms: textsAvailable && hasNumber,
    push: false,
  };

  function show(kind: NotificationKind, channel: NotificationChannel, on: boolean) {
    setRows((current) =>
      current.map((row) => (row.kind === kind ? { ...row, [channel]: on } : row))
    );
  }

  async function savePreference(
    kind: NotificationKind,
    channel: NotificationChannel,
    on: boolean
  ) {
    show(kind, channel, on);

    const response = await fetch("/api/v1/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, [channel]: on }),
    }).catch(() => null);

    if (response?.ok) return;
    show(kind, channel, !on);
    toast.error(await messageOf(response));
  }

  /**
   * Save part of the settings. The browser's time zone rides along every
   * time, so quiet hours and the summary hour are always measured on the
   * clock this person is actually living by.
   */
  async function saveSettings(change: Partial<NotificationSettings>) {
    const before = settings;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setSettings({ ...settings, ...change, timeZone });

    const response = await fetch("/api/v1/notifications/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...change, timeZone }),
    }).catch(() => null);

    if (response?.ok) {
      const body = (await response.json().catch(() => null)) as {
        data?: NotificationSettings;
      } | null;
      if (body?.data) setSettings(body.data);
      return true;
    }
    setSettings(before);
    toast.error(await messageOf(response));
    return false;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Which, and where. */}
      <div className="overflow-hidden rounded-lg border">
        <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_repeat(3,3.25rem)] items-end gap-1.5 border-b px-4 sm:grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] sm:gap-2 sm:px-5 py-2.5 font-label text-[10px] uppercase">
          <span>When…</span>
          {COLUMNS.map((column) => (
            <span key={column.channel} className="flex flex-col items-center gap-1 text-center">
              {column.channel === "push" || (column.channel === "sms" && !textsAvailable) ? (
                <ComingSoon className="hidden px-1 font-sans text-[9px] tracking-normal normal-case sm:inline-flex" />
              ) : null}
              {column.label}
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <div
            key={row.kind}
            className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.25rem)] items-center gap-1.5 border-b px-4 sm:grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] sm:gap-2 sm:px-5 py-3 last:border-b-0"
          >
            <Label htmlFor={`${row.kind}-email`} className="font-normal">
              {row.label}
            </Label>
            {COLUMNS.map(({ channel, label }) => (
              <div key={channel} className="flex justify-center">
                <Checkbox
                  id={`${row.kind}-${channel}`}
                  checked={usable[channel] ? row[channel] : false}
                  disabled={!usable[channel]}
                  onCheckedChange={(checked) =>
                    savePreference(row.kind, channel, checked === true)
                  }
                  aria-label={`${row.label}, by ${label.toLowerCase()}`}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="text-muted-foreground text-sm">
        Everything also shows in the app — the bell, top right — whatever is
        ticked here.
        {textsAvailable && !hasNumber
          ? " Add your mobile number below to turn texts on."
          : null}
        {emailAvailable
          ? null
          : " Email isn't set up on this server yet, so nothing is emailed — what you tick is kept for when it is."}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <EmailSection settings={settings} onSave={saveSettings} />
        <TextsSection
          settings={settings}
          available={textsAvailable}
          onSave={saveSettings}
        />
        <QuietSection
          settings={settings}
          available={textsAvailable}
          onSave={saveSettings}
        />
        <Card
          title="In the app"
          description="A pop-up in the corner when something happens while you're working. The bell keeps them either way."
        >
          <SwitchRow
            id="toasts"
            label="Pop-ups while I'm working"
            checked={settings.toasts}
            onChange={(toasts) => void saveSettings({ toasts })}
          />
        </Card>
      </div>
    </div>
  );
}

/* ── How often email comes ────────────────────────────────────────────── */

function EmailSection({
  settings,
  onSave,
}: {
  settings: NotificationSettings;
  onSave: (change: Partial<NotificationSettings>) => Promise<boolean>;
}) {
  const daily = settings.emailFrequency === "daily";

  return (
    <Card
      title="Email"
      description="As things happen, or everything in one summary a day."
    >
      <div className="grid grid-cols-2 gap-2">
        <Choice
          selected={!daily}
          onClick={() => void onSave({ emailFrequency: "instant" })}
        >
          As it happens
        </Choice>
        <Choice
          selected={daily}
          onClick={() => void onSave({ emailFrequency: "daily" })}
        >
          Once a day
        </Choice>
      </div>
      {daily ? (
        <div className="mt-3 flex items-center gap-3">
          <Label htmlFor="digest-hour" className="text-muted-foreground font-normal">
            Send it at
          </Label>
          <HourSelect
            id="digest-hour"
            value={settings.digestHour}
            onChange={(digestHour) => void onSave({ digestHour })}
          />
        </div>
      ) : null}
    </Card>
  );
}

/* ── Where texts go ───────────────────────────────────────────────────── */

function TextsSection({
  settings,
  available,
  onSave,
}: {
  settings: NotificationSettings;
  available: boolean;
  onSave: (change: Partial<NotificationSettings>) => Promise<boolean>;
}) {
  const [number, setNumber] = useState(
    settings.smsPhone ? formatPhone(settings.smsPhone) : ""
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const typed = number.trim();
  const e164 = typed ? toE164(typed) : null;
  const changed = (e164 ?? null) !== settings.smsPhone || (typed === "" && settings.smsPhone !== null);
  const valid = typed === "" || e164 !== null;

  async function save() {
    setSaving(true);
    const ok = await onSave({ smsPhone: typed === "" ? null : typed });
    setSaving(false);
    if (ok) {
      toast.success(typed ? "Number saved." : "Number removed — no texts will go out.");
      if (e164) setNumber(formatPhone(e164));
    }
  }

  async function test() {
    setTesting(true);
    const response = await fetch("/api/v1/notifications/test-text", {
      method: "POST",
    }).catch(() => null);
    setTesting(false);
    if (response?.ok) {
      toast.success(`Test text sent to ${formatPhone(settings.smsPhone!)}.`);
    } else {
      toast.error(await messageOf(response));
    }
  }

  return (
    <Card
      title="Texts"
      badge={available ? null : <ComingSoon />}
      description={
        available
          ? "Sent to your own mobile — only the events you tick for texts above."
          : "Texts aren't set up on this server yet. Your number is kept for when they are."
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="sms-phone">Mobile number</Label>
        <div className="flex gap-2">
          <Input
            id="sms-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            aria-invalid={!valid}
          />
          <Button
            variant="outline"
            onClick={save}
            disabled={!changed || !valid || saving}
          >
            {saving ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </div>
        {!valid ? (
          <p className="text-destructive text-xs">
            Include the area code — ten digits for a US number.
          </p>
        ) : null}
      </div>
      {available && settings.smsPhone ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground -ml-2 mt-2 self-start"
          onClick={test}
          disabled={testing || changed}
        >
          {testing ? <Loader2 className="animate-spin" /> : null}
          Send me a test text
        </Button>
      ) : null}
    </Card>
  );
}

/* ── The hours texts wait through ─────────────────────────────────────── */

function QuietSection({
  settings,
  available,
  onSave,
}: {
  settings: NotificationSettings;
  available: boolean;
  onSave: (change: Partial<NotificationSettings>) => Promise<boolean>;
}) {
  return (
    <Card
      title="Quiet hours"
      description="Texts that would land overnight wait until the morning. Email isn't held — it waits in your inbox anyway."
    >
      <SwitchRow
        id="quiet-hours"
        label="Hold texts overnight"
        checked={settings.quietHours}
        disabled={!available}
        onChange={(quietHours) => void onSave({ quietHours })}
      />
      {settings.quietHours ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Label htmlFor="quiet-start" className="text-muted-foreground font-normal">
            From
          </Label>
          <HourSelect
            id="quiet-start"
            value={settings.quietStart}
            onChange={(quietStart) => void onSave({ quietStart })}
          />
          <Label htmlFor="quiet-end" className="text-muted-foreground font-normal">
            until
          </Label>
          <HourSelect
            id="quiet-end"
            value={settings.quietEnd}
            onChange={(quietEnd) => void onSave({ quietEnd })}
          />
        </div>
      ) : null}
      {settings.timeZone ? (
        <p className="text-muted-foreground mt-3 text-xs">
          On your clock — {settings.timeZone.replace(/_/g, " ")}.
        </p>
      ) : null}
    </Card>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Card({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-lg border p-5">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {badge}
        </div>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function SwitchRow({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className={cn("font-normal", disabled && "text-muted-foreground")}>
        {label}
      </Label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={selected ? "default" : "outline"}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function HourSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (hour: number) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger id={id} className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: 24 }, (_, hour) => (
          <SelectItem key={hour} value={String(hour)}>
            {hourLabel(hour)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** 0 → "12 am", 13 → "1 pm". */
function hourLabel(hour: number) {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${suffix}`;
}

async function messageOf(response: Response | null) {
  const body = (await response?.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? "That didn't save — check your connection and try again.";
}
