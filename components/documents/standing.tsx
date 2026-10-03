import type { ReactNode } from "react";
import Link from "next/link";
import { Check, Circle, ShieldAlert, ShieldCheck } from "lucide-react";

import { LocalTime } from "@/components/local-time";
import { SignatureMark } from "@/components/signing/signature-mark";
import type { SignatureRecord } from "@/lib/signing/certificate";
import { cn } from "@/lib/utils";

/**
 * Where a signed document stands — the pieces the contract's overview and a
 * change order's page are both built from, so "signed", "opened" and "still
 * to come" look and mean the same on every document a job has.
 */

/* ── The story, in order ───────────────────────────────────────────────── */

export type TimelineStep = {
  /** When it happened. Null for a step still to come. */
  at: Date | null;
  label: string;
  detail?: string;
};

/**
 * What has happened, oldest first, each step read from the record that proves
 * it — and the steps still to come after them, quiet, so the shape of what's
 * left is visible before it has happened.
 */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="border-t pt-2">
      {steps.map((step, index) => (
        <li key={index} className="flex items-start gap-3 py-2.5">
          <span
            className={cn(
              "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
              step.at ? "bg-foreground text-background" : "text-muted-foreground"
            )}
          >
            {step.at ? (
              <Check className="size-3" strokeWidth={3} />
            ) : (
              <Circle className="size-4" strokeDasharray="3 3" />
            )}
          </span>
          <div className="min-w-0">
            <p className={cn("text-sm", step.at ? "" : "text-muted-foreground")}>
              {step.label}
            </p>
            <p className="text-muted-foreground text-xs">
              {step.at ? <LocalTime iso={step.at.toISOString()} /> : "Not yet"}
              {step.detail ? ` · ${step.detail}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Sends and visits, as steps — the same words on every document. */
export function activitySteps({
  sends,
  visits,
  who,
}: {
  sends: { channel: string; recipient: string | null; sentAt: Date }[];
  visits: Date[];
  /** The customer's first name. */
  who: string;
}): TimelineStep[] {
  return [
    ...sends.map((send) => ({
      at: send.sentAt,
      label:
        send.channel === "email"
          ? `Emailed to ${send.recipient ?? who}`
          : send.channel === "text"
            ? `Texted to ${send.recipient ?? who}`
            : "You copied the link to send",
    })),
    ...visits.map((visit) => ({ at: visit, label: `${who} opened it` })),
  ];
}

/** Done steps in the order they happened. */
export function inOrder(steps: TimelineStep[]) {
  return [...steps].sort((a, b) => a.at!.getTime() - b.at!.getTime());
}

/* ── Signatures ────────────────────────────────────────────────────────── */

/**
 * One party's line: who signed, when, how, and the mark itself — or, unsigned,
 * whose move it is and what unblocks it.
 */
export function SignatureLine({
  label,
  signature,
  pending,
}: {
  label: string;
  signature: SignatureRecord | undefined;
  pending: ReactNode;
}) {
  // Laid out the way the paper does it: the mark on its own line, then the
  // printed name and the evidence under it. Beside the name, a typed name in
  // a script face ran wider than its box and wrapped out of the panel.
  return (
    <div className="min-w-0 border-t py-4">
      <p className="text-muted-foreground font-label text-[10px] uppercase">
        {label}
      </p>
      {signature ? (
        <>
          <div className="border-muted-foreground/40 mt-2 flex h-12 max-w-sm min-w-0 items-end overflow-hidden border-b pb-1">
            <SignatureMark
              value={signature.mark.value}
              className="h-10 max-w-full truncate text-[26px] leading-none"
            />
          </div>
          <p className="mt-2 text-sm font-medium">{signature.printedName}</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            <LocalTime iso={signature.signedAt.toISOString()} /> ·{" "}
            {signature.mark.kind === "drawn" ? "Drawn" : "Typed"} ·{" "}
            {signature.authMethod === "share_link"
              ? "through their private link"
              : "signed in to ServiceClerk"}
            {signature.consentedAt ? " · agreed to sign electronically" : ""}
          </p>
        </>
      ) : (
        <p className="text-muted-foreground mt-1 text-sm">{pending}</p>
      )}
    </div>
  );
}

/**
 * Whether the page still says what was signed — three different facts, not
 * two: every signature matches; one was recorded before signatures carried a
 * fingerprint, so it can't be checked; or one was taken against different
 * content, which is the only one that's alarming.
 */
export function IntegrityNote({
  signatures,
  recordHref,
}: {
  signatures: SignatureRecord[];
  /** The printable signing record, where there is one. */
  recordHref?: string;
}) {
  if (signatures.length === 0) return null;

  const mismatch = signatures.some(
    (entry) => !entry.integrity.verified && entry.integrity.recorded !== null
  );
  const unchecked = signatures.some((entry) => entry.integrity.recorded === null);

  return (
    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs">
      <span
        className={cn(
          "flex items-center gap-1.5",
          mismatch ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {mismatch ? (
          <ShieldAlert className="size-3.5" />
        ) : (
          <ShieldCheck className="size-3.5" />
        )}
        {mismatch
          ? "The page doesn't match what was signed — check the signing record"
          : unchecked
            ? "One signature was recorded without a fingerprint, so it can't be checked against the page"
            : "Unchanged since it was signed"}
      </span>
      {recordHref ? (
        <Link
          href={recordHref}
          className="hover:text-foreground text-muted-foreground underline underline-offset-4"
        >
          Signing record
        </Link>
      ) : null}
    </div>
  );
}
