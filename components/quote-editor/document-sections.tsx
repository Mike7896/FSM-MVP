"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { EditableText } from "@/components/fields";
import {
  EYEBROW,
  FIELD_LABEL,
  SectionCard,
  SectionNumber,
} from "@/components/quote-editor/section-heading";
import { SignatureMark } from "@/components/signing/signature-mark";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  appliedSignature,
  signsOnQuote,
  type OfficeSignature,
} from "@/lib/signing/lines";
import {
  documentSection,
  formatChange,
  formatMoney,
  termsSentence,
  type ChangeOrderContext,
  type DocumentSectionId,
  type QuoteDraft,
  type QuoteTotals,
} from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * **The four sections that are not authored.**
 *
 * Header is a lookup, Pricing a calculation, Terms a derivation, Acceptance a
 * state transition — which is why they share a file and Scope has a directory.
 * All five are present from the first second, including the ones he will never
 * touch: the shape of a finished quote is visible before it is finished, and
 * that is what makes it obvious what is still missing without a checklist
 * saying so.
 *
 * Each is a numbered card carrying its name and what it holds — see
 * `section-heading.tsx` for why all three. At phone width Header collapses to a
 * single numbered row and Scope gets the rest of the screen. At the desk
 * Pricing, Terms and Acceptance move to the rail, still numbered 3 to 5, so the
 * order reads across both columns.
 */

export type OfficeIdentity = {
  businessName: string | null;
  license: string | null;
  phone: string | null;
  logoUrl?: string | null;
  /** The adopted signature — what Acceptance shows on the business's line. */
  signature?: OfficeSignature | null;
};

/* ── Header ───────────────────────────────────────────────────────────── */

/**
 * Parties, address, number, and the document type word.
 *
 * Two sides, the way the paper sets them: **For** — the customer and the
 * work, the two things typed here — and **From** — the business, read from
 * the Office and never edited on a quote.
 *
 * A value the shop has not given us is **drawn as a gap — never invented, and
 * never silently dropped**: a dashed "License number" where it will go is the
 * version he actually notices.
 */
export function HeaderSection({
  draft,
  office,
  address,
  onChange,
  collapsed,
  onExpand,
  changeOrder,
}: {
  draft: QuoteDraft;
  office: OfficeIdentity;
  address?: string | null;
  onChange: (patch: Partial<QuoteDraft>) => void;
  collapsed?: boolean;
  onExpand?: () => void;
  /**
   * A change order's header. The customer is the signed contract's — not
   * something a change can edit — so it is shown rather than asked for, and
   * the document names the contract it amends.
   */
  changeOrder?: ChangeOrderContext;
}) {
  const word = changeOrder ? "Change order" : "Quote";

  if (collapsed) {
    const summary = [
      office.businessName,
      draft.number ?? word,
      office.license ? `License #${office.license}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return <CollapsedRow id="header" detail={summary} onClick={onExpand} />;
  }


  return (
    <SectionCard
      id="header"
      hint={!draft.customerName.trim() && !draft.title.trim()}
    >
      <div className="grid gap-x-8 gap-y-6 @3xl:grid-cols-[minmax(0,1fr)_17rem]">
        {/* For — the two things typed here, side by side once there's room. */}
        <div className="grid content-start gap-4">
          <p className={EYEBROW}>For</p>
          <div className="grid gap-4 @lg:grid-cols-2">
            {changeOrder ? (
              <div className="grid content-start gap-1.5">
                <span className={FIELD_LABEL}>Customer</span>
                <p className="flex min-h-10 items-center text-[15px] font-medium">
                  {draft.customerName || "The customer"}
                </p>
              </div>
            ) : (
              <label className="grid content-start gap-1.5">
                <span className={FIELD_LABEL}>Customer</span>
                <EditableText
                  className="text-[15px] md:text-[15px]"
                  value={draft.customerName}
                  placeholder="Who is this for?"
                  aria-label="Customer"
                  onChange={(event) =>
                    onChange({ customerName: event.target.value })
                  }
                />
              </label>
            )}
            <label className="grid content-start gap-1.5">
              <span className={FIELD_LABEL}>
                {changeOrder ? "The change" : "Work title"}
              </span>
              <EditableText
                className="text-[15px] md:text-[15px]"
                value={draft.title}
                placeholder={changeOrder ? "Name the change" : "What's the work?"}
                aria-label={changeOrder ? "The change" : "The work"}
                onChange={(event) => onChange({ title: event.target.value })}
              />
            </label>
          </div>
          {address ? (
            <div className="grid gap-1">
              <span className={FIELD_LABEL}>Job address</span>
              <p className="text-muted-foreground text-sm">{address}</p>
            </div>
          ) : null}
        </div>

        {/* From — the Office's, read-only here. */}
        <div className="bg-muted/40 grid content-start gap-3 rounded-lg border p-4">
          <p className={EYEBROW}>From</p>
          <dl className="grid gap-2.5 text-sm">
            <FromLine label="Business">
              {office.businessName ? (
                <span className="font-medium">{office.businessName}</span>
              ) : (
                <Gap>Your business name</Gap>
              )}
            </FromLine>
            <FromLine label="License">
              {office.license ? (
                `#${office.license}`
              ) : (
                <span className="text-muted-foreground">None — optional</span>
              )}
            </FromLine>
            {office.phone ? (
              <FromLine label="Phone">{office.phone}</FromLine>
            ) : null}
            <FromLine label={`${word} no.`}>
              {draft.number ?? (
                <span className="text-muted-foreground">On first save</span>
              )}
              {changeOrder?.contractNumber ? (
                <span className="text-muted-foreground">
                  {" "}
                  · amends {changeOrder.contractNumber}
                </span>
              ) : null}
            </FromLine>
          </dl>
          {office.businessName ? null : (
            // Stated, not nagged about, and never blocking.
            <p className="text-muted-foreground border-t pt-3 text-[13px] leading-snug">
              Add your business name in the Office — it heads every quote you
              send.
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function FromLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2">
      <dt className="text-muted-foreground text-[13px]">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** A slot the shop has not filled yet, drawn as a slot. */
function Gap({ children }: { children: ReactNode }) {
  return (
    <span className="text-muted-foreground border-muted-foreground/50 border-b border-dashed">
      {children}
    </span>
  );
}

/* ── Pricing ──────────────────────────────────────────────────────────── */

/**
 * The arithmetic — **always visible, never behind a tap.**
 *
 * At the desk it heads the rail; when the rail folds it comes down into the
 * document rather than disappearing. Three tiers, so the eye lands in order:
 * the lines that make the total, the total, and how it gets paid.
 *
 * **The optional rows sit below the total, framed,** because they are not in
 * it — above the total they'd read as part of the sum.
 */
export function PricingSection({
  draft,
  sums,
  onOpenTerms,
  changeOrder,
}: {
  draft: QuoteDraft;
  sums: QuoteTotals;
  onOpenTerms: () => void;
  /** Set in delta mode: the agreed amount this change is measured against. */
  changeOrder?: { agreedPriceCents: number };
}) {
  const { depositCents, balanceCents } = sums;
  const rate = draft.taxRate;

  return (
    <SectionCard
      id="pricing"
      hint={false}
      aside={
        <button
          type="button"
          onClick={onOpenTerms}
          className="text-primary-ink underline underline-offset-4"
        >
          Change
        </button>
      }
    >
      {/* How it's priced, in one line — what "Change" opens. */}
      <p className="text-muted-foreground text-[13px] leading-snug">
        {describeDecisions(draft)}
      </p>

      <dl className="mt-4 grid gap-2">
        <MoneyLine label="Subtotal" cents={sums.subtotalCents} />
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <dt className="text-muted-foreground">
            Tax{rate !== null ? ` (${formatRate(rate)})` : ""}
          </dt>
          <dd className="tabular-nums">
            {rate !== null ? (
              <span className={toneOf(sums.taxCents)}>
                {formatMoney(sums.taxCents)}
              </span>
            ) : (
              // No rate is not a zero rate — and it's worth a second look.
              <button
                type="button"
                onClick={onOpenTerms}
                className="text-primary-ink text-[13px] font-medium underline underline-offset-4"
              >
                No rate set
              </button>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex items-baseline justify-between gap-3 border-t pt-3">
        <span className="text-[15px] font-semibold">
          {changeOrder ? "This change" : "Total"}
        </span>
        <span
          className={cn(
            "text-[28px] leading-none font-bold tracking-tight tabular-nums",
            changeOrder ? changeTone(sums.totalCents) : toneOf(sums.totalCents)
          )}
        >
          {changeOrder
            ? formatChange(sums.totalCents)
            : formatMoney(sums.totalCents)}
        </span>
      </div>

      {changeOrder ? (
        <p className="text-muted-foreground mt-2 text-right text-[13px]">
          Contract after this change{" "}
          <span className="text-foreground font-medium tabular-nums">
            {formatMoney(changeOrder.agreedPriceCents + sums.totalCents)}
          </span>
        </p>
      ) : null}

      {sums.optionalCents > 0 ? (
        <p className="text-muted-foreground border-muted-foreground/30 mt-3 rounded-md border border-dashed px-3 py-2 text-[13px] leading-snug">
          <span className="text-foreground font-medium tabular-nums">
            +{formatMoney(sums.optionalCents)}
          </span>{" "}
          in optional rows if your customer adds them. Not in the total.
        </p>
      ) : null}

      {/* How it gets paid. */}
      <div className="bg-muted/50 mt-4 rounded-lg px-3 py-3">
        {depositCents === null ? (
          <button
            type="button"
            onClick={onOpenTerms}
            className="text-primary-ink w-full text-left text-sm font-medium underline underline-offset-4"
          >
            Set a deposit and how you get paid
          </button>
        ) : (
          <dl className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="font-medium">
                Deposit{" "}
                <span className="text-muted-foreground font-normal">
                  ({draft.terms.depositPercent}%)
                </span>
              </dt>
              <dd className="font-semibold tabular-nums">
                {formatMoney(depositCents)}
              </dd>
            </div>
            <MoneyLine label="Balance after deposit" cents={balanceCents} />
          </dl>
        )}
      </div>
    </SectionCard>
  );
}

/** A label and an amount, quiet — the lines that make up a bigger number. */
function MoneyLine({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", toneOf(cents))}>{formatMoney(cents)}</dd>
    </div>
  );
}

/** Red for a negative amount — a credit, or a total that has gone below zero. */
function toneOf(cents: number): string | undefined {
  return cents < 0 ? "text-negative" : undefined;
}

/** A change order's difference: green when it adds, red when it takes away. */
function changeTone(cents: number): string | undefined {
  if (cents > 0) return "text-positive";
  if (cents < 0) return "text-negative";
  return undefined;
}

/** 0.0825 → "8.25%", 0.06 → "6%". */
function formatRate(rate: number): string {
  return `${Number((rate * 100).toFixed(3))}%`;
}

/**
 * The five decisions, said in one line, in his register.
 *
 * He reads the mechanism — fixed price, itemised, 30% deposit. She reads the
 * consequence, in Terms. Same source, different words.
 */
function describeDecisions(draft: QuoteDraft): string {
  const { contractType, priceStructure, depositPercent } = draft.terms;

  const words: string[] = [];
  if (contractType === "lump_sum") words.push("Fixed price");
  else if (contractType === "time_and_materials")
    words.push("Time and materials");
  else if (contractType === "cost_plus") words.push("Cost plus");
  else if (contractType === "unit_price") words.push("Unit price");
  else if (contractType === "gmp") words.push("Guaranteed maximum");
  else if (contractType === "flat_rate_menu") words.push("Flat rate");

  if (priceStructure === "itemized") words.push("itemised");
  else if (priceStructure === "single_total") words.push("one number");
  else if (priceStructure === "partitioned") words.push("base plus fees");
  else if (priceStructure === "tiered") words.push("options");

  if (depositPercent !== null) words.push(`${depositPercent}% deposit`);

  return words.join(" · ") || "How this is priced";
}

/* ── Terms ────────────────────────────────────────────────────────────── */

/**
 * What the price commits to, in the customer's words.
 *
 * **Derived, not authored.** Terms comes from settings and the five decisions
 * and applies across quotes; anything written for one job belongs in Scope.
 * That rule is what decides where an exclusion goes, and it is why this section
 * is a sentence and an override rather than a text field.
 */
export function TermsSection({
  draft,
  sums,
  onOpenTerms,
  collapsed,
}: {
  draft: QuoteDraft;
  sums: QuoteTotals;
  onOpenTerms: () => void;
  collapsed?: boolean;
}) {
  if (collapsed) {
    return (
      <CollapsedRow
        id="terms"
        detail="From your standard terms"
        onClick={onOpenTerms}
      />
    );
  }

  return (
    <SectionCard
      id="terms"
      hint={false}
      aside={
        <button
          type="button"
          onClick={onOpenTerms}
          className="text-primary-ink underline underline-offset-4"
        >
          Change
        </button>
      }
    >
      <p className="text-muted-foreground text-sm leading-relaxed">
        {termsSentence(draft, sums)}
      </p>
    </SectionCard>
  );
}

/* ── Acceptance ───────────────────────────────────────────────────────── */

/**
 * The signatures — and the one choice about them.
 *
 * **Acceptance is not content, it is state** — the transition that freezes the
 * document and generates the Contract. Nothing here is typed. What the
 * contractor decides is only *whether the quote carries signature lines*: on,
 * the customer accepts by signing the quote itself and the contract arrives
 * signed by both; off, she approves with a button and signs the contract after.
 *
 * The lines are previewed as the paper will draw them, so the business's line
 * shows the signature that will actually be on it — and when there isn't one,
 * the empty line is the way to add it.
 *
 * It never claims a signature that isn't there. "Yours is on file" on a first
 * quote, with nothing on file, is how every other number on a screen gets
 * doubted.
 */
export function AcceptanceSection({
  customerName,
  businessName,
  signatureLines,
  onSignatureLines,
  signature,
  onEditSignature,
  collapsed,
}: {
  customerName: string;
  businessName: string | null;
  signatureLines: boolean;
  onSignatureLines: (on: boolean) => void;
  /** The Office's adopted signature, if any. */
  signature: OfficeSignature | null | undefined;
  /**
   * Opens the Office's signature, to add one or change how it's applied.
   * Absent before the Office exists, when there is nowhere to keep one.
   */
  onEditSignature?: () => void;
  collapsed?: boolean;
}) {
  const who = customerName.trim().split(/\s+/)[0] || "Your customer";
  const signing = signsOnQuote({ signatureLines }, signature);
  const applied = appliedSignature(signature);

  if (collapsed) {
    return (
      <CollapsedRow
        id="acceptance"
        detail={signing ? `${who} signs the quote` : `${who} approves, then signs`}
      />
    );
  }

  return (
    <SectionCard id="acceptance" hint={false}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="signature-lines" className="text-sm font-medium">
          Signature lines
        </Label>
        <Switch
          id="signature-lines"
          checked={signatureLines}
          onCheckedChange={onSignatureLines}
        />
      </div>

      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {!signatureLines
          ? `${who} approves with a button, then signs the contract.`
          : signing
            ? `${who} signs right on the quote to accept it. The contract is created signed by you both.`
            : `${who} can sign right on the quote once your signature is on it. Until then, ${who} approves with a button and signs the contract after you.`}
      </p>

      {signatureLines ? (
        <div className="mt-4 grid gap-4 @md:grid-cols-2">
          <MiniLine who={businessName ? `For ${businessName}` : "For the business"}>
            {applied ? (
              <button
                type="button"
                onClick={onEditSignature}
                disabled={!onEditSignature}
                title="Change your signature"
                className="hover:bg-muted/60 -mx-1 flex h-full w-[calc(100%+0.5rem)] items-end rounded-md px-1 transition-colors disabled:hover:bg-transparent"
              >
                <SignatureMark
                  value={applied.mark}
                  className="h-10 w-auto max-w-full text-2xl leading-none"
                />
              </button>
            ) : !onEditSignature ? null : (
              // The empty line is the way to fill it — the same move as the
              // gaps in the letterhead.
              <button
                type="button"
                onClick={onEditSignature}
                className="text-primary-ink border-muted-foreground/50 hover:border-foreground flex h-9 w-full items-center justify-center rounded-md border border-dashed text-xs transition-colors"
              >
                {signature ? "Apply your signature" : "Add your signature"}
              </button>
            )}
          </MiniLine>
          <MiniLine who={customerName.trim() || "Your customer"}>
            <span className="text-muted-foreground pb-1 text-xs">
              {signing ? `${who} signs here` : null}
            </span>
          </MiniLine>
        </div>
      ) : null}
    </SectionCard>
  );
}

/** One signature line, small: room for a mark, the rule, whose it is. */
function MiniLine({ who, children }: { who: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex h-11 items-end">{children}</div>
      <div className="border-foreground/50 border-t" />
      <p className="text-muted-foreground mt-1 truncate text-xs">{who}</p>
    </div>
  );
}

/* ── The shared collapsed row ─────────────────────────────────────────── */

/**
 * A section reduced to one numbered line stating what it holds.
 *
 * Header wears this at phone width. Present, not demanding — which is the
 * point: the shape of a finished quote is visible before it is finished.
 */
function CollapsedRow({
  id,
  detail,
  onClick,
}: {
  id: DocumentSectionId;
  detail: string;
  onClick?: () => void;
}) {
  const section = documentSection(id);

  const content = (
    <div className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
      <span className="flex shrink-0 items-center gap-2.5">
        <SectionNumber id={id} />
        <span className="text-base font-semibold tracking-tight">
          {section.label}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground truncate text-sm">{detail}</span>
        {onClick ? (
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <span className="size-4 shrink-0" />
        )}
      </span>
    </div>
  );

  const frame = "bg-card w-full scroll-mt-20 rounded-xl border";

  if (!onClick) {
    return (
      <section data-tour={`quote.${id}`} className={frame}>
        {content}
      </section>
    );
  }

  return (
    <button
      type="button"
      data-tour={`quote.${id}`}
      onClick={onClick}
      className={cn(frame, "hover:bg-muted/50 dark:hover:bg-muted transition-colors")}
    >
      {content}
    </button>
  );
}

export type { ChangeOrderContext };
