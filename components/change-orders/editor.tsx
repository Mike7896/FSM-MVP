"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { QuoteEditor, type QuoteEditorController } from "@/components/quote-editor";
import type { ChangeTarget } from "@/components/quote-editor/change-order-sections";
import {
  EditorCard,
  FIELD_LABEL,
} from "@/components/quote-editor/section-heading";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { ConsentNotice } from "@/components/signing/consent-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { apiJson } from "@/lib/api/client";
import type { agreedChangeTargets, readChangeOrder } from "@/lib/change-orders/service";
import type { CaptureItem } from "@/lib/queries/captures";
import type { OfficeIdentity } from "@/lib/queries/office";
import {
  draftFromRecord,
  formatChange,
  formatMoney,
  toSavePayload,
  totals,
  type QuoteDraft,
} from "@/lib/quote";
import { cn } from "@/lib/utils";

type Loaded = Awaited<ReturnType<typeof readChangeOrder>>;
type Billing = "next_draw" | "supplemental";

/**
 * The change order editor — **the quote editor, pointed at a change.**
 *
 * Same surface, same geography: what happened on site on the left, the
 * document in the middle, the money in a column on the right, and the one
 * action in the bar at the top. A contractor who has written a quote already
 * knows where everything is. What differs is only what a change needs — the
 * signed contract it amends, line by line, in the document; the schedule and
 * billing of the change in the money column — and none of it floats above or
 * below the editor as a separate form.
 *
 * **Review & send opens the signing, it doesn't scroll to it.** The business
 * signs a change before the customer sees it, so sending is one decision made
 * in one place: what's changing and what it costs, who signs, where it goes.
 */
export function ChangeOrderEditor({
  initial,
  office,
  parentContractId,
  agreedPriceCents,
  contractNumber,
  loaded,
  requestId,
  targets,
  captures = [],
  signerName,
  customerEmail,
}: {
  initial: QuoteDraft;
  office: OfficeIdentity;
  parentContractId: string;
  agreedPriceCents: number;
  /** `C-0001` — the contract this amends. */
  contractNumber: string | null;
  loaded?: Loaded;
  requestId?: string;
  captures?: CaptureItem[];
  targets: Awaited<ReturnType<typeof agreedChangeTargets>>;
  /** Who signs for the business, as far as the Office knows. */
  signerName: string | null;
  /** Where the customer's copy usually goes. */
  customerEmail: string | null;
}) {
  const router = useRouter();
  const jobId = loaded?.doc.jobId ?? initial.jobId;
  const id = useRef(loaded?.doc.id ?? "");
  const revision = useRef(loaded?.revision);
  const controller = useRef<QuoteEditorController>(null);

  const [days, setDays] = useState(loaded?.doc.details?.timeImpactDays ?? 0);
  const [billing, setBilling] = useState<Billing>(
    (loaded?.doc.details?.billingMode as Billing | undefined) ?? "next_draw"
  );

  const [review, setReview] = useState<QuoteDraft | null>(null);
  const [name, setName] = useState(signerName ?? "");
  const [email, setEmail] = useState(customerEmail ?? "");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    url: string;
    deliveryError: string | null;
  } | null>(null);

  // One write at a time. The editor's autosave and a schedule or billing
  // change both write the same row with a revision; two in flight at once
  // would race each other into a conflict.
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const put = useCallback(
    async (draft: QuoteDraft) => {
      id.current ||= crypto.randomUUID();
      const response = await fetch(`/api/v1/change-orders/${id.current}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...toSavePayload(draft),
          parentContractId,
          requestId,
          revision: revision.current,
          timeImpactDays: days,
          billingMode: billing,
        }),
      });
      const body = await response.json();
      if (!response.ok) return Response.json(body, { status: response.status });
      const saved = body.data as Loaded;
      revision.current = saved.revision;
      // A real address for the draft, so a refresh or a copied link reopens it.
      window.history.replaceState(
        null,
        "",
        `/jobs/${saved.doc.jobId}/change-orders/${saved.doc.id}`
      );
      return Response.json({ data: saved.record });
    },
    [parentContractId, requestId, days, billing]
  );

  const saveRequest = useCallback(
    (draft: QuoteDraft) => {
      const run = chain.current.then(
        () => put(draft),
        () => put(draft)
      );
      chain.current = run.catch(() => undefined);
      return run;
    },
    [put]
  );

  /** Saves the draft as it stands, with the schedule and billing beside it. */
  const persist = useCallback(async () => {
    const draft = await controller.current?.saveNow();
    if (!draft) throw new Error("Couldn't save the change.");
    const response = await saveRequest(draft);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message ?? "Couldn't save the change.");
    }
    return draft;
  }, [saveRequest]);

  // Schedule and billing aren't part of the document's text, so the editor's
  // autosave doesn't see them change. Saved here instead — once the change
  // has a row; before that they ride along with its first save.
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current || !id.current) return;
    const timer = setTimeout(() => {
      persist().catch((cause) =>
        toast.error(cause instanceof Error ? cause.message : "Couldn't save.")
      );
    }, 600);
    return () => clearTimeout(timer);
  }, [days, billing, persist]);

  async function openReview(draft: QuoteDraft) {
    setError(null);
    try {
      const response = await saveRequest(draft);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Couldn't save the change.");
      }
      setReview(draft);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't save.");
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await persist();
      setResult(
        await apiJson(`/api/v1/change-orders/${id.current}/send`, "POST", {
          revision: revision.current,
          printedName: name.trim(),
          consented: consent,
          ...(email.trim() ? { email: email.trim() } : {}),
        })
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't send.");
    } finally {
      setBusy(false);
    }
  }

  function done() {
    router.push(`/jobs/${jobId}/change-orders/${id.current}`);
    router.refresh();
  }

  const change = review ? totals(review).totalCents : 0;

  return (
    <>
      <QuoteEditor
        captures={captures}
        initial={loaded ? draftFromRecord(loaded.record) : initial}
        office={office}
        mode="change-order"
        jobId={jobId ?? undefined}
        changeOrder={{
          parentContractId,
          agreedPriceCents,
          whatChanged: "",
          contractNumber,
        }}
        changeTargets={targets as ChangeTarget[]}
        changePanels={
          <>
            <SchedulePanel
              days={days}
              onDays={(value) => {
                touched.current = true;
                setDays(value);
              }}
            />
            <BillingPanel
              billing={billing}
              onBilling={(value) => {
                touched.current = true;
                setBilling(value);
              }}
            />
          </>
        }
        controllerRef={controller}
        saveRequest={saveRequest}
        onBack={() => router.push(`/jobs/${jobId}/contract`)}
        onPreview={openReview}
        previewLabel="Review & send"
      />

      <ResponsiveDialog
        open={review !== null}
        onOpenChange={(open) => {
          if (busy) return;
          if (!open && result) done();
          if (!open) setReview(null);
        }}
      >
        <ResponsiveDialogContent>
          {result ? (
            <Sent
              result={result}
              emailed={Boolean(email.trim())}
              customerName={review?.customerName ?? ""}
              onDone={done}
            />
          ) : (
            <>
              <ResponsiveDialogHeader
                title="Sign and send the change"
                description="You sign first. Then it goes to your customer to approve or decline — and once it's sent, this version can't be edited."
              />
              <ResponsiveDialogBody className="flex flex-col gap-5">
                <div className="rounded-lg border">
                  <div className="border-b px-4 py-3">
                    <p className="text-muted-foreground font-label text-[10px] uppercase">
                      {[review?.number ?? "Change order", contractNumber && `amends ${contractNumber}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="mt-1 font-medium">
                      {review?.title.trim() || "Untitled change"}
                    </p>
                  </div>
                  <dl className="grid gap-1.5 px-4 py-3 text-sm">
                    <Fact label="This change" value={formatChange(change)} strong />
                    <Fact
                      label="Contract after it"
                      value={formatMoney(agreedPriceCents + change)}
                    />
                    <Fact label="Schedule" value={scheduleWords(days)} />
                    <Fact
                      label="Billed"
                      value={
                        billing === "supplemental"
                          ? "On its own invoice"
                          : "With the next payment"
                      }
                    />
                  </dl>
                </div>

                <label className="grid gap-1.5">
                  <span className={FIELD_LABEL}>Sign as</span>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    aria-label="Your name"
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className={FIELD_LABEL}>Email it to</span>
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    aria-label="Customer email"
                  />
                  <span className="text-muted-foreground text-xs">
                    Leave it empty to get a link you can send yourself.
                  </span>
                </label>

                <ConsentNotice
                  checked={consent}
                  onCheckedChange={setConsent}
                  businessName={office.businessName}
                />

                {error ? (
                  <p role="alert" className="text-destructive text-sm">
                    {error}
                  </p>
                ) : null}
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setReview(null)}
                >
                  Keep editing
                </Button>
                <Button
                  disabled={busy || !name.trim() || !consent}
                  onClick={send}
                >
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  {email.trim() ? "Sign & email it" : "Sign & get the link"}
                </Button>
              </ResponsiveDialogFooter>
            </>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

/* ── The money column's own panels ─────────────────────────────────────── */

function SchedulePanel({
  days,
  onDays,
}: {
  days: number;
  onDays: (days: number) => void;
}) {
  return (
    <EditorCard label="Schedule" hint="What this does to the finish date.">
      <label className="grid gap-1.5">
        <span className={FIELD_LABEL}>Days added</span>
        <div className="relative">
          <Input
            type="number"
            inputMode="numeric"
            step="1"
            className="pr-14 tabular-nums"
            value={days}
            onChange={(event) =>
              onDays(Math.trunc(Number(event.target.value) || 0))
            }
          />
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">
            {Math.abs(days) === 1 ? "day" : "days"}
          </span>
        </div>
      </label>
      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
        {scheduleWords(days)}. A negative number takes days off.
      </p>
    </EditorCard>
  );
}

function BillingPanel({
  billing,
  onBilling,
}: {
  billing: Billing;
  onBilling: (billing: Billing) => void;
}) {
  const options: { value: Billing; label: string; detail: string }[] = [
    {
      value: "next_draw",
      label: "With the next payment",
      detail: "Added to the next unbilled draw, or the final balance.",
    },
    {
      value: "supplemental",
      label: "On its own invoice",
      detail: "Billed separately once they approve it.",
    },
  ];

  return (
    <EditorCard label="Billing" hint="When the change gets paid for.">
      <RadioGroup
        value={billing}
        onValueChange={(value) => onBilling(value as Billing)}
        className="gap-3"
      >
        {options.map((option) => (
          <Label
            key={option.value}
            htmlFor={`billing-${option.value}`}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors",
              billing === option.value
                ? "border-primary/60 bg-primary/5"
                : "hover:bg-muted/50"
            )}
          >
            <RadioGroupItem
              id={`billing-${option.value}`}
              value={option.value}
              className="mt-0.5"
            />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-muted-foreground text-xs leading-snug">
                {option.detail}
              </span>
            </span>
          </Label>
        ))}
      </RadioGroup>
    </EditorCard>
  );
}

/* ── After it's sent ───────────────────────────────────────────────────── */

function Sent({
  result,
  emailed,
  customerName,
  onDone,
}: {
  result: { url: string; deliveryError: string | null };
  emailed: boolean;
  customerName: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const first = customerName.trim().split(/\s+/)[0] || "your customer";

  async function copy() {
    await navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <ResponsiveDialogHeader
        title={
          emailed && !result.deliveryError
            ? `Sent to ${first}`
            : "Signed — ready to share"
        }
        description={
          result.deliveryError ??
          (emailed
            ? `${first} can approve or decline it from the email. You'll see it on the contract when they do.`
            : `Send ${first} this link to approve or decline it.`)
        }
      />
      <ResponsiveDialogBody>
        <div className="bg-muted/50 flex items-center gap-2 rounded-lg border p-2 pl-3">
          <span className="min-w-0 flex-1 truncate text-sm">{result.url}</span>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </ResponsiveDialogBody>
      <ResponsiveDialogFooter className="flex justify-end">
        <Button onClick={onDone}>Done</Button>
      </ResponsiveDialogFooter>
    </>
  );
}

function Fact({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong && "font-medium")}>{value}</dd>
    </div>
  );
}

function scheduleWords(days: number) {
  if (days === 0) return "No change to the schedule";
  const count = `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"}`;
  return days > 0 ? `Adds ${count}` : `Takes ${count} off`;
}
