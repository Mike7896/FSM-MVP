"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Check, ChevronRight, ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { uploadJobPhoto } from "@/lib/captures/upload";
import type { PhaseEvidence, PhaseView } from "@/lib/queries/phases";
import { formatMoney } from "@/lib/quote";
import { cn } from "@/lib/utils";

export type JobPhoto = {
  id: string;
  url: string;
  caption: string | null;
  promotedToEvidenceId: string | null;
};

/**
 * Marking a phase complete — Screen 18, the evidence flow.
 *
 * **The job's own phases, each drawn for where it stands.** A deposit has
 * nothing to mark. A phase not done yet asks for a write-up and photos. A
 * phase marked done but not billed shows its proof and offers the bill. A
 * billed phase shows what went out with it. The page used to offer the same
 * three invented phases on every job; now it can only offer what the plan
 * says.
 *
 * **Photos and write-up and bill in one motion** is the default — the proof is
 * what makes a mid-job ask land as expected rather than out of nowhere — but
 * "Save without billing" is always there for the phase finished today and
 * billed on Friday.
 */
export function PhaseComplete({
  jobId,
  phases,
  photos,
  initialPhaseId,
}: {
  jobId: string;
  phases: PhaseView[];
  photos: JobPhoto[];
  initialPhaseId?: string;
}) {
  const first =
    phases.find((phase) => phase.id === initialPhaseId) ??
    phases.find(
      (phase) => phase.gate !== "on_acceptance" && phase.invoiceId === null
    ) ??
    phases[0];

  const [openId, setOpenId] = useState<string | null>(first?.id ?? null);

  return (
    <ol className="flex flex-col gap-3">
      {phases.map((phase) => {
        const open = openId === phase.id;
        return (
          <li
            key={phase.id}
            className={cn("rounded-xl border", open && "border-foreground/30")}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : phase.id)}
              className="hover:bg-muted/40 flex w-full items-center justify-between gap-4 rounded-xl px-5 py-4 text-left transition-colors"
            >
              <span className="min-w-0">
                <span className="block font-medium">{phase.name}</span>
                <span className="text-muted-foreground mt-0.5 block text-xs">
                  {phase.detail}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="font-medium tabular-nums">
                  {formatMoney(phase.amountCents)}
                </span>
                <StateTag phase={phase} />
              </span>
            </button>

            {open ? (
              <div className="border-t px-5 py-5">
                <PhasePanel jobId={jobId} phase={phase} photos={photos} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function StateTag({ phase }: { phase: PhaseView }) {
  const label =
    phase.state === "paid"
      ? "Paid"
      : phase.state === "sent"
        ? "Billed"
        : phase.gate === "on_acceptance"
          ? "Deposit"
          : phase.evidence
            ? "Done"
            : "Not done";

  return (
    <span
      className={cn(
        "rounded-md border px-2 py-0.5 font-label text-[10px] uppercase",
        label === "Done" && "border-foreground/40 text-foreground",
        label !== "Done" && "text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}

function PhasePanel({
  jobId,
  phase,
  photos,
}: {
  jobId: string;
  phase: PhaseView;
  photos: JobPhoto[];
}) {
  const [editing, setEditing] = useState(false);

  if (phase.gate === "on_acceptance") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          A deposit is due when your customer accepts, so there&apos;s no phase to
          mark complete.
        </p>
        {phase.invoiceId ? <InvoiceLink invoiceId={phase.invoiceId} /> : null}
      </div>
    );
  }

  if (phase.invoiceId) {
    return (
      <div className="flex flex-col gap-4">
        <EvidenceView evidence={phase.evidence} />
        <InvoiceLink invoiceId={phase.invoiceId} />
      </div>
    );
  }

  if (phase.evidence && !editing) {
    return (
      <div className="flex flex-col gap-4">
        <EvidenceView evidence={phase.evidence} />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit the proof
          </Button>
          <BillButton jobId={jobId} phase={phase} />
        </div>
      </div>
    );
  }

  return (
    <EvidenceForm
      jobId={jobId}
      phase={phase}
      photos={photos}
      onCancel={phase.evidence ? () => setEditing(false) : undefined}
      onSaved={() => setEditing(false)}
    />
  );
}

function EvidenceForm({
  jobId,
  phase,
  photos,
  onCancel,
  onSaved,
}: {
  jobId: string;
  phase: PhaseView;
  photos: JobPhoto[];
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(phase.evidence?.summary ?? "");
  const [picked, setPicked] = useState<string[]>(phase.evidence?.captureIds ?? []);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  // Photos this phase can use — not already proof for a different phase.
  const available = photos.filter(
    (photo) =>
      photo.promotedToEvidenceId === null ||
      photo.promotedToEvidenceId === phase.evidence?.id
  );

  const final = phase.gate === "on_completion";
  const canBill = phase.amountCents > 0;

  async function addPhotos(files: FileList | null) {
    const images = [...(files ?? [])].filter((file) =>
      file.type.startsWith("image/")
    );
    if (images.length === 0) return;

    setUploading(true);
    try {
      // One at a time: several multi-megabyte uploads at once is how a phone
      // connection drops all of them.
      for (const file of images) {
        const { id } = await uploadJobPhoto(jobId, file);
        setPicked((current) => [...current, id]);
      }
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't add those photos."
      );
    } finally {
      setUploading(false);
    }
  }

  function submit(bill: boolean) {
    startTransition(async () => {
      const saved = await send(
        `/api/v1/jobs/${jobId}/phases/${phase.id}/evidence`,
        { summary, captureIds: picked }
      );
      if (!saved.ok) {
        toast.error(saved.message);
        return;
      }

      if (!bill) {
        toast.success(`${phase.name} marked complete. Bill it when you're ready.`);
        onSaved();
        router.refresh();
        return;
      }

      const invoice = await billPhase(jobId, phase);
      if (!invoice.ok) {
        // The proof is saved either way — say so, rather than implying the
        // whole thing failed.
        toast.error(`${phase.name} is marked complete, but the bill didn't go out: ${invoice.message}`);
        onSaved();
        router.refresh();
        return;
      }
      router.push(`/invoices/${invoice.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-sm">{hint(phase)}</p>

      <div className="grid gap-2">
        <Label htmlFor={`summary-${phase.id}`}>
          {final ? "What was done on the whole job" : "What was done"}
        </Label>
        <Textarea
          id={`summary-${phase.id}`}
          rows={4}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="Plain language — your customer reads this before the bill. What's finished, and what passed inspection."
        />
      </div>

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label>Photos</Label>
          <span className="text-muted-foreground text-xs tabular-nums">
            {picked.length} picked
          </span>
        </div>

        {available.length ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {available.map((photo) => {
              const on = picked.includes(photo.id);
              return (
                <button
                  key={photo.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={photo.caption ?? "Job photo"}
                  onClick={() =>
                    setPicked((current) =>
                      on
                        ? current.filter((id) => id !== photo.id)
                        : [...current, photo.id]
                    )
                  }
                  className={cn(
                    "relative aspect-square overflow-hidden rounded-lg border",
                    on &&
                      "ring-foreground ring-2 ring-offset-2 ring-offset-[var(--color-background)]"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URLs */}
                  <img
                    src={photo.url}
                    alt=""
                    className="size-full object-cover"
                  />
                  {on ? (
                    <span className="bg-foreground text-background absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full">
                      <Check className="size-3" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {photos.length
              ? "Every photo on this job is already proof for another phase. Add new ones for this one."
              : "No photos on this job yet."}
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
          {uploading ? "Adding..." : "Add photos"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void addPhotos(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        ) : null}
        <Button
          variant="outline"
          onClick={() => submit(false)}
          disabled={pending || !summary.trim()}
        >
          Save without billing
        </Button>
        <Button
          onClick={() => submit(true)}
          disabled={pending || !summary.trim() || !canBill}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Submit &amp; bill {formatMoney(phase.amountCents)}
        </Button>
      </div>

      {!canBill ? (
        <p className="text-muted-foreground text-right text-xs">
          This phase has no amount yet —{" "}
          <Link
            href={`/jobs/${jobId}/money#phases`}
            className="underline underline-offset-4"
          >
            set one on the plan
          </Link>{" "}
          to bill it.
        </p>
      ) : null}
    </div>
  );
}

function EvidenceView({ evidence }: { evidence: PhaseEvidence | null }) {
  if (!evidence) {
    return (
      <p className="text-muted-foreground text-sm">
        Billed without a write-up or photos.
      </p>
    );
  }

  const shown = evidence.photos.filter((photo) => photo.url);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed whitespace-pre-line">
        {evidence.summary}
      </p>
      {shown.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {shown.map((photo) => (
            <div
              key={photo.id}
              className="aspect-square overflow-hidden rounded-lg border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URLs */}
              <img
                src={photo.url!}
                alt={photo.caption ?? ""}
                className="size-full object-cover"
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">No photos attached.</p>
      )}
    </div>
  );
}

function BillButton({ jobId, phase }: { jobId: string; phase: PhaseView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      disabled={pending || phase.amountCents <= 0}
      onClick={() =>
        startTransition(async () => {
          const invoice = await billPhase(jobId, phase);
          if (!invoice.ok) {
            toast.error(invoice.message);
            return;
          }
          router.push(`/invoices/${invoice.id}`);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : null}
      Bill {formatMoney(phase.amountCents)}
    </Button>
  );
}

function InvoiceLink({ invoiceId }: { invoiceId: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="self-start">
      <Link href={`/invoices/${invoiceId}`}>
        Open the invoice
        <ChevronRight />
      </Link>
    </Button>
  );
}

/** What the form is for, said for the kind of phase it is. */
function hint(phase: PhaseView): string {
  if (phase.gate === "on_completion") {
    return "The last one. Write up the whole job — your customer sees this with the final bill.";
  }
  if (phase.gate === "inspection_passed") {
    return "This phase is billed once the inspection passes. Write up what's done and attach the proof.";
  }
  return "Photos and a short write-up go to your customer with the bill, so the ask arrives expected rather than out of nowhere.";
}

/** Bills one planned phase — the invoice route marks the phase billed. */
/**
 * Billing the phase.
 *
 * The balance at the end is the **final invoice** — it carries the settlement,
 * with the deposit and every draw already taken off — so it has its own route
 * rather than being billed at the number on the plan. Everything before it is a
 * draw against the gate this phase named.
 */
async function billPhase(
  jobId: string,
  phase: PhaseView
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const result =
    phase.gate === "on_completion"
      ? await send(`/api/v1/jobs/${jobId}/final-invoice`, {})
      : await send(`/api/v1/jobs/${jobId}/phases/${phase.id}/bill`, {});

  if (!result.ok) return result;
  const id = (result.data as { invoiceId?: string } | undefined)?.invoiceId;
  return id
    ? { ok: true, id }
    : { ok: false, message: "The bill was created but came back without an id." };
}

async function send(
  url: string,
  payload: unknown
): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => null);

  const body = (await response?.json().catch(() => null)) as {
    data?: unknown;
    error?: { message?: string };
  } | null;

  if (!response?.ok) {
    return {
      ok: false,
      message:
        body?.error?.message ??
        "Couldn't reach the server, so nothing was saved. Try again.",
    };
  }

  return { ok: true, data: body?.data };
}
