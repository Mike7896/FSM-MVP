import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

import { inkFor } from "@/components/documents/ink";
import { Letterhead } from "@/components/documents/letterhead";
import { SignatureLines } from "@/components/signing/signature-lines";
import { Separator } from "@/components/ui/separator";
import {
  customerDetail,
  customerLines,
  formatMoney,
  isPriced,
  isText,
  nodeTotal,
  paymentPlan,
  paymentSchedule,
  phaseSections,
  termsSentence,
  totals,
  unpricedRows,
  type CustomerLine,
  type QuoteDraft,
  type ScopeNode,
} from "@/lib/quote";
import type { DocumentLook } from "@/lib/branding";
import type { DocumentSignatures } from "@/lib/signing/lines";
import { cn } from "@/lib/utils";

/**
 * The homeowner's view of a quote.
 *
 * **A projection, not a preview of a document.** The contractor is shown the
 * live share page rather than a PDF render on purpose: the link *is* the sales
 * surface, and showing a PDF would demote it to a document in his head — which
 * is precisely the mental model the homeowner experience exists to replace.
 *
 * Rendered from the same `QuoteDraft` and the same `totals()` the editor uses,
 * so the number he is looking at and the number she will be looking at cannot
 * come apart. That is also why this is a server-renderable component with no
 * state of its own: the share route can render it directly for her.
 *
 * **Her register, not his.** He reads the mechanism — a tree, cost buckets, a
 * markup. She reads the consequence, in sentences.
 *
 * **How much of the tree she sees is the contractor's choice** — one total,
 * the top-level rows, or every row, with each group able to override it for
 * itself (`lib/quote/disclosure.ts`). Rows inside a group she's shown sit
 * indented under it, and their amounts add up to the group's.
 *
 * **Hiding detail never means deleting detail.** Every row below is derived
 * from the same tree the estimator built, and nothing about what she is shown
 * changes what he holds.
 *
 * **A demo says so on the paper.** The document is the thing that could be
 * mistaken for real work, so the label sits in the letterhead rather than only
 * in the app around it.
 */

export type HeaderGap = "businessName" | "license";

export function QuoteProjection({
  draft,
  businessName,
  license,
  phone,
  logoUrl,
  look,
  demo = false,
  onGap,
  action,
  signatures,
  signatureBlock,
  signaturePrompt,
  documentLabel,
}: {
  draft: QuoteDraft;
  businessName: string | null;
  license: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  /**
   * The Office's look: the logo beside the name, the band behind it. Left out,
   * a logo given is drawn and there's no band.
   */
  look?: DocumentLook;
  demo?: boolean;
  /**
   * The contractor's preview only. Turns the unfilled letterhead into gaps he
   * can tap to fill; her page never passes it, so nothing on it is tappable.
   */
  onGap?: (gap: HeaderGap) => void;
  /**
   * What sits where the action goes. Left out, the contractor's preview draws
   * the button as the customer will see it; the share page passes the working
   * one — or the state that replaces it — and `null` for nothing at all.
   */
  action?: ReactNode;
  /**
   * Who has signed, for the lines at the foot. The business's line carries its
   * stored signature ahead of acceptance and the recorded one after; left
   * out, both lines are blank.
   */
  signatures?: DocumentSignatures;
  /**
   * Whether the paper ends in signature lines. The quote's own choice unless
   * overridden — a contract always has them, whatever its quote said.
   */
  signatureBlock?: boolean;
  /** What the customer's empty line says in place of a mark. */
  signaturePrompt?: string | null;
  /**
   * The document's name printed above its title — "Contract". A contract
   * reads as a contract before a word of it is read, in the same ink as its
   * miniature on the job.
   */
  documentLabel?: string;
}) {
  const sums = totals(draft);
  const customerName = draft.customerName.trim() || "your customer";

  // The rows the contractor chose to show her. Unpriced text is gathered below
  // under its own heading rather than sitting between priced rows, because an
  // exclusion reads as a promise and a priced row reads as a charge.
  const detail = customerDetail(draft.terms);
  const rows = customerLines(draft.scope, detail);
  // One total still prints the money — just not the rows behind it.
  const priced = draft.scope.some(function walk(node): boolean {
    return (isPriced(node) && !node.optional) || node.children.some(walk);
  });
  // How the money comes in, stage by stage — **shown before she decides**, so
  // a mid-job ask is never a surprise. Billed in phases by scope, the rows are
  // read phase by phase too, each with what it bills when it's done.
  const plan = paymentPlan(draft, sums);
  const schedule = paymentSchedule(draft, plan);
  const phases = phaseSections(draft, plan);
  const optional = collectOptional(draft.scope);
  const { exclusions, assumptions, notes } = unpricedRows(draft);

  const lines = signatureBlock ?? draft.signatureLines;
  // She signs the quote itself only when the business's line is already
  // signed — see `signsOnQuote`. The preview's stand-in button says so.
  const signing = lines && Boolean(signatures?.contractor);

  return (
    <div className="flex flex-col gap-6">
      <header>
        {demo ? (
          <p className="text-muted-foreground mb-3 inline-block rounded border border-dashed px-2 py-0.5 font-label text-[10px] uppercase">
            Demo · not a real quote
          </p>
        ) : null}
        <Letterhead
          logoUrl={look?.logo === false ? null : logoUrl}
          bold={look?.bold}
        >
          {businessName ? (
            <p className="text-base font-semibold tracking-tight">{businessName}</p>
          ) : (
            // The gap shows on the document rather than blocking the preview.
            // That visibility is what makes the ask for it persuasive later.
            <Gap onClick={onGap ? () => onGap("businessName") : undefined}>
              Your business name
            </Gap>
          )}
          {/* A license is optional — plenty of work doesn't need one — so no
              license is no line, not a blank to fill. */}
          {license ? (
            <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
              <ShieldCheck className="size-3" />
              LIC #{license}
            </p>
          ) : null}
          {phone ? (
            <p className="text-muted-foreground mt-1 text-xs">{phone}</p>
          ) : null}
        </Letterhead>
        {/* Who it is for and which document it is, on one line — the way a
            document says it, rather than as two interface labels. */}
        <p className="text-muted-foreground mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-xs">
          <span>Prepared for {customerName}</span>
          {draft.number ? <span className="tabular-nums">{draft.number}</span> : null}
        </p>
      </header>

      <Separator />

      <section>
        {documentLabel ? (
          <p
            className={cn(
              "font-label mb-1.5 text-[11px] font-semibold uppercase",
              inkFor(documentLabel).word
            )}
          >
            {documentLabel}
          </p>
        ) : null}
        <h3 className="text-base font-semibold tracking-tight">
          {draft.title || "Your quote"}
        </h3>
        {draft.scopeOfWork ? (
          <p className="text-muted-foreground mt-1.5 leading-relaxed">
            {draft.scopeOfWork}
          </p>
        ) : null}
      </section>

      {phases.length ? (
        phases.map((phase) => (
          <section key={phase.key}>
            <p className="font-label mb-1 text-[11px] font-semibold uppercase">
              {phase.heading}
            </p>
            {phase.lines.map((line) => (
              <Line key={line.node.key} line={line} />
            ))}
            {phase.names.length ? (
              <p className="border-t py-2 leading-relaxed">{phase.names.join(" · ")}</p>
            ) : null}
            <div className="flex items-baseline justify-between gap-3 border-t pt-2 font-medium">
              <span className="min-w-0">
                {phase.when}
                {phase.note ? (
                  <span className="text-muted-foreground block text-xs font-normal">
                    {phase.note}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatMoney(phase.billedCents)}
              </span>
            </div>
          </section>
        ))
      ) : null}

      {phases.length || rows.length || (detail === "total" && priced) ? (
        <section>
          {phases.length
            ? null
            : rows.map((line) => <Line key={line.node.key} line={line} />)}

          {sums.taxCents > 0 ? (
            <>
              <div className="text-muted-foreground flex items-baseline justify-between border-t py-2">
                <span>Subtotal</span>
                <span className="tabular-nums">
                  {formatMoney(sums.subtotalCents)}
                </span>
              </div>
              <div className="text-muted-foreground flex items-baseline justify-between border-t py-2">
                <span>Tax</span>
                <span className="tabular-nums">{formatMoney(sums.taxCents)}</span>
              </div>
            </>
          ) : null}

          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="font-label text-[11px] uppercase">
              Total
            </span>
            <span className="text-2xl font-semibold tabular-nums">
              {formatMoney(sums.totalCents)}
            </span>
          </div>
        </section>
      ) : null}

      {/* **Below the total, framed, because it is not in it.** Above the total
          an optional row would be a fourth number a reader adds in and gets the
          wrong answer — an itemised page whose lines disagree with its own
          total is the one thing this cannot do. Below it, framed, with what it
          does to the total said out loud, it reads as an offer rather than a
          line. */}
      {optional.length ? (
        <section className="border-muted-foreground/40 rounded-md border border-dashed p-3">
          <p className="text-muted-foreground font-label text-[10px] uppercase">
            You can add
          </p>
          {optional.map((node) => (
            <div
              key={node.key}
              className="mt-1.5 flex items-baseline justify-between gap-3"
            >
              <span className="min-w-0">{node.description || "Extra work"}</span>
              <span className="shrink-0 tabular-nums">
                +{formatMoney(nodeTotal(node))}
              </span>
            </div>
          ))}
          <p className="text-muted-foreground mt-2 text-xs">
            Tap to add — your total updates.
          </p>
        </section>
      ) : null}

      {/* Exclusions survive every projection. They are the mechanism by which
          excluded work does not become free work, so disclosure of price and
          disclosure of boundary are separate questions: hiding the arithmetic
          never hides the boundary. */}
      <UnpricedBlock heading="Not included" nodes={exclusions} />
      <UnpricedBlock heading="Conditions this price assumes" nodes={assumptions} />
      <UnpricedBlock heading="Please note" nodes={notes} />

      <p className="leading-relaxed">{termsSentence(draft, sums)}</p>

      {schedule.length ? (
        <section>
          <p className="text-muted-foreground font-label text-[10px] uppercase">
            How you&apos;ll pay
          </p>
          {schedule.map((stage, index) => (
            <div
              key={`${stage.name}-${index}`}
              className="mt-1.5 flex items-baseline justify-between gap-3 border-t pt-1.5 first:border-t-0"
            >
              <span className="min-w-0">
                {stage.name}
                <span className="text-muted-foreground block text-xs">
                  {stage.when}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {formatMoney(stage.amountCents)}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {lines ? (
        <SignatureLines
          businessName={businessName}
          customerName={draft.customerName}
          signatures={signatures ?? { contractor: null, customer: null }}
          prompt={signaturePrompt}
        />
      ) : null}

      {action === undefined ? (
        <>
          <div
            data-control
            className="bg-primary text-primary-foreground rounded-md px-4 py-3 text-center font-medium"
          >
            {signing ? signLabel(draft) : approveLabel(draft)}
          </div>
          <p className="text-muted-foreground text-center text-xs">
            {signing
              ? "No account needed. Sign with a finger, or type your name."
              : "No account needed — this link is all it takes."}
          </p>
        </>
      ) : (
        action
      )}
    </div>
  );
}

/** One priced row as she reads it. */
function Line({ line: { node, depth, amountCents } }: { line: CustomerLine }) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 border-t py-2",
        // Inside a group she's shown: indented under it, quieter, and ruled
        // lighter, so the group's own line reads as the sum.
        depth > 0 && "border-border/50 text-muted-foreground py-1.5 text-[0.9em]"
      )}
      style={depth > 0 ? { paddingLeft: `${depth * 1.25}rem` } : undefined}
    >
      <span className="min-w-0">
        {node.description || "Work"}
        {node.type === "allowance" ? (
          // An allowance is a provisional sum, and she has to know that before
          // she agrees to it — otherwise the true-up arrives as a surprise on
          // the final bill.
          <span className="text-muted-foreground block text-xs">
            An allowance — trued up to the actual cost once you choose.
          </span>
        ) : null}
      </span>
      <span className="shrink-0 tabular-nums">{formatMoney(amountCents)}</span>
    </div>
  );
}

/**
 * What the one action on a quote says. The money it commits to is on the
 * button, because on a money surface the number is what happens.
 */
export function approveLabel(draft: QuoteDraft) {
  const { depositCents } = totals(draft);
  return depositCents
    ? `Approve & pay ${formatMoney(depositCents)} deposit`
    : "Approve this quote";
}

/**
 * The same action when accepting *is* signing. Signing is what happens on the
 * press, so it leads; the deposit still comes after, on the next page.
 */
export function signLabel(draft: QuoteDraft) {
  const { depositCents } = totals(draft);
  return depositCents
    ? `Sign & pay ${formatMoney(depositCents)} deposit`
    : "Sign & approve";
}

/**
 * A slot the business has not filled, drawn as a slot — and a button when the
 * contractor is the one looking, so the gap is also the way to fill it.
 */
function Gap({
  children,
  onClick,
  small = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  small?: boolean;
}) {
  const className = `text-muted-foreground border-muted-foreground/50 inline-block rounded border border-dashed ${
    small ? "px-1.5 py-px text-xs" : "px-2 py-0.5 text-xs"
  }`;

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${className} hover:border-foreground hover:text-foreground transition-colors`}
    >
      {children}
    </button>
  ) : (
    <span className={className}>{children}</span>
  );
}

function UnpricedBlock({
  heading,
  nodes,
}: {
  heading: string;
  nodes: ScopeNode[];
}) {
  const written = nodes.filter((node) => node.description.trim() !== "");
  if (!written.length) return null;

  return (
    <section>
      <p className="text-muted-foreground font-label text-[10px] uppercase">
        {heading}
      </p>
      <ul className="mt-1 space-y-1">
        {written.map((node) => (
          <li key={node.key} className="leading-relaxed">
            {node.description}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The optional rows, wherever they sit in the tree.
 *
 * Only the **outermost** one of a nested pair is collected, which is what the
 * early `continue` is for: an optional row inside an optional group is already
 * covered by the group's own price, and listing both would offer her the same
 * work twice at two prices.
 */
function collectOptional(scope: ScopeNode[]): ScopeNode[] {
  const out: ScopeNode[] = [];

  function step(nodes: ScopeNode[]) {
    for (const node of nodes) {
      if (node.optional) {
        if (!isText(node)) out.push(node);
        continue;
      }
      if (node.children.length) step(node.children);
    }
  }

  step(scope);
  return out;
}
