"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentFooter } from "@/components/documents/document-sheet";
import { LogoField } from "@/components/office/logo-field";
import { OfficeDocumentPreview } from "@/components/office/document-preview";
import { SaveStatus, type SaveState } from "@/components/office/save-status";
import { QuoteProjection } from "@/components/quote/projection";
import { emptyDraft } from "@/lib/quote";
import type { Office } from "@/lib/queries/office";
import {
  updateOfficeSchema,
  type OfficeFormValues,
} from "@/lib/schemas";

/**
 * An empty quote, so the preview is the header and nothing else.
 *
 * Everything drawn on it is his — the name, phone and license he has entered,
 * and visible gaps where he hasn't. No invented customer, job or price sits
 * around them.
 */
const EMPTY_QUOTE = emptyDraft();

/** How long after the last keystroke a change is saved. */
const SAVE_AFTER_MS = 800;

type Fields = Omit<OfficeFormValues, "logoUrl">;

/**
 * Screen 27 · the Office's own attributes · job O2.
 *
 * The form sits beside a live projection of the document, because the reason
 * to fill it in is that the customer is about to read it. The projection is
 * the **real** one — the same component the homeowner's page renders.
 *
 * **It saves itself.** A pause in typing, or leaving a field, saves; the
 * status line above the fields says when it has. An invalid field (a blank
 * business name, a malformed email) is shown and not saved.
 */
export function IdentityForm({
  office,
  license,
  presetName,
  logoOnDocuments,
}: {
  office: Office;
  /** The number a document would carry today, from the License Manager. */
  license: string | null;
  /** What document branding is currently set to. */
  presetName: string;
  /** Whether the plan puts the logo on documents (Pro). */
  logoOnDocuments: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState(office.logoUrl ?? null);

  const form = useForm<Fields>({
    resolver: zodResolver(updateOfficeSchema.omit({ logoUrl: true })),
    mode: "onChange",
    defaultValues: {
      name: office.name ?? "",
      phone: office.phone ?? "",
      email: office.email ?? "",
      address: office.address ?? "",
      website: office.website ?? "",
    },
  });

  // `useWatch` rather than `form.watch()`: the latter returns a function the
  // React Compiler cannot memoize. This subscribes to what the preview reads.
  const values = useWatch({ control: form.control });

  const timer = useRef<number | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const lastSaved = useRef(JSON.stringify(form.getValues()));

  /** One save. Says how it went, so the caller knows whether to go again. */
  const persist = useCallback(async (): Promise<SaveState> => {
    const snapshot = form.getValues();
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSaved.current) {
      setState("saved");
      return "saved";
    }
    if (!(await form.trigger())) {
      setState("invalid");
      return "invalid";
    }

    setState("saving");
    const response = await fetch("/api/v1/office", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: serialized,
    }).catch(() => null);

    if (!response?.ok) {
      const body = (await response?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? "Couldn't save.");
      setState("error");
      return "error";
    }

    lastSaved.current = serialized;
    // Typing that landed while this was in flight goes in the next save.
    if (JSON.stringify(form.getValues()) !== serialized) {
      setState("pending");
      return "pending";
    }
    setState("saved");
    // The header, the editor and every projection read this.
    router.refresh();
    return "saved";
  }, [form, router]);

  // The latest `flush`, for the timer to call — it outlives the render that
  // set it.
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => void flushRef.current(),
      SAVE_AFTER_MS
    );
  }, []);

  const flush = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    // One save at a time, in order.
    while (running.current) await running.current;
    const run = persist();
    running.current = run.then(() => undefined);
    const outcome = await run;
    running.current = null;
    if (outcome === "pending") schedule();
  }, [persist, schedule]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // A change starts the clock; another change restarts it.
  useEffect(
    () =>
      form.subscribe({
        formState: { values: true },
        callback: ({ type }) => {
          if (type !== "change") return;
          setState("pending");
          schedule();
        },
      }),
    [form, schedule]
  );

  // Leaving the page with a change still waiting sends it anyway.
  useEffect(
    () => () => {
      if (timer.current === null) return;
      window.clearTimeout(timer.current);
      const snapshot = JSON.stringify(form.getValues());
      if (snapshot === lastSaved.current) return;
      void fetch("/api/v1/office", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: snapshot,
        keepalive: true,
      });
    },
    [form]
  );

  function changeLogo(next: string | null) {
    setLogoUrl(next);
    setState("saved");
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void flush();
      }}
      // Leaving a field saves it now rather than after the pause.
      onBlur={() => {
        if (timer.current !== null) void flush();
      }}
      className="w-full max-w-6xl @container/identity flex min-w-0 flex-col gap-6"
    >
      {/* Use the panel's width: the app and Office sidebars also take space. */}
      <div className="grid min-w-0 gap-6 @4xl/identity:grid-cols-[minmax(0,1fr)_480px]">
        <div className="@container/fields flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-6 rounded-xl border bg-card p-5 sm:p-6 [&_input]:h-10">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-4">
              <h2 className="text-base font-semibold">Business details</h2>
              <SaveStatus
                state={state}
                error={error}
                onRetry={() => void flush()}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="name">Business name</Label>
              <Input id="name" {...form.register("name")} />
              <FieldNote error={form.formState.errors.name?.message}>
                Goes at the top of every quote, contract and invoice you send.
              </FieldNote>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" {...form.register("address")} />
              <FieldNote error={form.formState.errors.address?.message}>
                Where the business is, not where the work is.
              </FieldNote>
            </div>

            <div className="grid gap-4 @md/fields:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" type="tel" {...form.register("phone")} />
                <FieldNote error={form.formState.errors.phone?.message}>
                  Shown on the document so she can just call you.
                </FieldNote>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...form.register("email")} />
                <FieldNote error={form.formState.errors.email?.message}>
                  Where a customer&apos;s reply lands.
                </FieldNote>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" {...form.register("website")} />
              <FieldNote error={form.formState.errors.website?.message}>
                Optional. One more thing a customer can check you against.
              </FieldNote>
            </div>

            <div className="grid gap-2">
              <Label>Logo</Label>
              <LogoField logoUrl={logoUrl} onChange={changeLogo} />
              {logoOnDocuments ? null : (
                <p className="text-muted-foreground text-xs">
                  Your logo goes on documents with{" "}
                  <Link
                    href="/account/billing/plan"
                    className="text-primary-ink underline underline-offset-4"
                  >
                    Pro
                  </Link>
                  . Upload it now and it appears once you&apos;re on Pro.
                </p>
              )}
            </div>
          </div>

          {/* Two rows that point out rather than in. License number and logo
              placement belong to other pages in the Office, so they are links
              carrying their live value rather than duplicated controls. */}
          <div className="rounded-xl border bg-card">
            <p className="text-muted-foreground border-b px-5 py-4 text-sm font-semibold">
              What else goes in the header
            </p>
            <OutRow
              label="License number"
              value={license ? `#${license}` : "Nothing on file yet"}
              note="Matched to the job's township, per quote"
              href="/office/licenses"
              linkText="Licenses"
            />
            <OutRow
              label="Logo placement and look"
              value={presetName}
              note="Three presets, previewed as she sees them"
              href="/office/branding"
              linkText="Document branding"
            />
          </div>

          <p className="text-muted-foreground rounded-xl border border-dashed p-5 text-sm leading-relaxed">
            Everything on this page is the{" "}
            <strong className="text-foreground font-medium">
              business&apos;s
            </strong>
            , which is why it&apos;s here and not in Settings. Your own sign-in
            and what you pay us with are yours, and they live in{" "}
            <Link
              href="/account"
              className="text-primary-ink underline underline-offset-4"
            >
              Account
            </Link>
            .
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-2 @4xl/identity:sticky @4xl/identity:top-22 @4xl/identity:self-start">
          <p className="text-sm font-semibold">
            On every document you send
          </p>
          <OfficeDocumentPreview
            footer={<DocumentFooter businessName={values.name?.trim() || null} />}
          >
            <QuoteProjection
              draft={EMPTY_QUOTE}
              businessName={values.name?.trim() || null}
              license={license}
              phone={values.phone?.trim() || null}
              logoUrl={logoOnDocuments ? logoUrl : null}
              action={null}
            />
          </OfficeDocumentPreview>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {license ? (
              <>
                The license number came from{" "}
                <Link
                  href="/office/licenses"
                  className="underline underline-offset-4"
                >
                  Licenses
                </Link>
                , matched to the job&apos;s township. Everything else on this
                header came from this page.
              </>
            ) : (
              <>
                Everything on this header came from this page. The license
                number would come from{" "}
                <Link
                  href="/office/licenses"
                  className="underline underline-offset-4"
                >
                  Licenses
                </Link>
                , matched to the job&apos;s township.
              </>
            )}
          </p>
        </div>
      </div>
    </form>
  );
}

function FieldNote({
  error,
  children,
}: {
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={
        error ? "text-destructive text-xs" : "text-muted-foreground text-xs"
      }
    >
      {error ?? children}
    </p>
  );
}

/**
 * A row that names something on another Office page and shows its live value.
 *
 * Duplicating the control here would give the contractor two places to change
 * one thing; showing the value and linking out gives them one place to change
 * it and one place to check it.
 */
function OutRow({
  label,
  value,
  note,
  href,
  linkText,
}: {
  label: string;
  value: string;
  note: string;
  href: string;
  linkText: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b px-5 py-4 last:border-b-0 @xl/fields:flex-row @xl/fields:flex-wrap @xl/fields:items-baseline @xl/fields:justify-between @xl/fields:gap-x-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{note}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 text-sm tabular-nums [overflow-wrap:anywhere]">{value}</span>
        <Link
          href={href}
          className="text-primary-ink text-sm underline underline-offset-4"
        >
          {linkText}
        </Link>
      </div>
    </div>
  );
}
