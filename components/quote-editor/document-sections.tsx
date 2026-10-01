"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { EditableText } from "@/components/fields";
import {
  FIELD_LABEL,
  SectionCard,
  SectionNumber,
} from "@/components/quote-editor/section-heading";
import { SignatureMark } from "@/components/signing/signature-mark";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  appliedSignature,
  signsOnQuote,
  type OfficeSignature,
} from "@/lib/signing/lines";
import {
  documentSection,
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
 * **The document type word is a legal fact rather than a label.** In several
 * jurisdictions "quote", "estimate" and "bid" attach different statutory
 * tolerances and authorisation duties, and it sits here because this is where
 * the customer reads it.
 *
 * Customer and work title use labelled fields so their purpose stays visible
 * after a value has been entered.
 *
 * A value the shop has not given us is **drawn as a gap — never invented, and
 * never silently dropped.** A plausible placeholder hides that the license
 * number is missing, and so does leaving its slot out; a dashed "License
 * number" where it will go is the version he actually notices.
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

  const missing = [
    office.businessName ? null : "business name",
    office.license ? null : "license number",
  ].filter((gap): gap is string => gap !== null);

  return (
    <SectionCard
      id="header"
      hint={!draft.customerName.trim() && !draft.title.trim()}
    >
      <div className="grid gap-4">
        {changeOrder ? (
          <div className="grid gap-1.5">
            <span className={FIELD_LABEL}>Customer</span>
            <p className="text-lg font-semibold tracking-tight">
              {draft.customerName || "The customer"}
            </p>
          </div>
        ) : (
          <label className="grid gap-1.5">
            <span className={FIELD_LABEL}>Customer name</span>
            <EditableText
              tone="title"
              value={draft.customerName}
              placeholder="Who is this for?"
              aria-label="Customer"
              onChange={(event) => onChange({ customerName: event.target.value })}
            />
          </label>
        )}
        <label className="grid gap-1.5">
          <span className={FIELD_LABEL}>
            {changeOrder ? "The change" : "Work title"}
          </span>
          <EditableText
            value={draft.title}
            placeholder={changeOrder ? "Name the change" : "What's the work?"}
            aria-label={changeOrder ? "The change" : "The work"}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </label>
      </div>

      <p className="text-muted-foreground mt-5 border-t pt-4 text-xs leading-relaxed">
        {office.businessName ? (
          <span className="text-foreground font-medium">
            {office.businessName}
          </span>
        ) : (
          <Gap>Your business name</Gap>
        )}
        {" · "}
        {draft.number ?? word}
        {changeOrder?.contractNumber
          ? ` · amends ${changeOrder.contractNumber}`
          : null}
        {address ? ` · ${address}` : null}
        {" · "}
        {office.license ? (
          `License #${office.license}`
        ) : (
          <Gap>License number</Gap>
        )}
      </p>

      {missing.length ? (
        // Stated, not nagged about, and never blocking. Homeowners look for
        // both, and seeing the hole is worth more to him than a tidy header.
        <p className="text-muted-foreground mt-1.5 text-xs">
          {missing.length === 2
            ? "Add your business name and license number"
            : `Add your ${missing[0]}`}{" "}
          — they head every quote you send.
        </p>
      ) : null}
    </SectionCard>
  );
}

/** A slot the shop has not filled yet, drawn as a slot. */
function Gap({ children }: { children: ReactNode }) {
  return (
    <span className="border-muted-foreground/50 border-b border-dashed">
      {children}
    </span>
  );
}

/* ── Pricing ──────────────────────────────────────────────────────────── */

/**
 * The arithmetic — **always visible, never behind a tap.**
 *
 * The anxiety this screen fights is specific: *am I going to lose money on this
 * number, and am I about to look like an amateur.* A total that has to be
 * opened is a total that gets guessed at, so it is on the page at every width.
 * Only its home moves: at the desk it heads the rail, and when the rail folds
 * it comes down into the document rather than disappearing.
 *
 * **Cost buckets are not here.** Material, labor, equipment and permit are
 * where a priced row lands, not how the document is organised — they surface in
 * the margin view and the price book. Pricing holds subtotal, tax, total,
 * deposit and the schedule, which is what this section is for.
 *
 * **The optional row sits below the total, framed.** Because it is not in it.
 * Above the total it would be a number a reader adds in and gets the wrong
 * answer — an itemised page whose lines disagree with its own total is the one
 * thing this cannot do.
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
  const { depositCents } = sums;
  const rate = draft.taxRate;

  return (
    // Once there are numbers, the numbers explain the section.
    <SectionCard id="pricing" hint={sums.totalCents === 0}>
      <button
        type="button"
        onClick={onOpenTerms}
        // Wider than the column by its own padding, so the hover fill bleeds
        // and "Change" lands on the same right edge as the numbers below.
        className="text-muted-foreground hover:bg-muted/60 -mx-1.5 mb-3 flex w-[calc(100%+0.75rem)] items-baseline justify-between gap-3 rounded-md px-1.5 py-1 text-left text-xs leading-snug transition-colors"
      >
        {/* Wraps rather than truncates: "itemised · 30% deposit" is the part
            that got cut off, and it is the part he opens the sheet to check. */}
        <span className="min-w-0">{describeDecisions(draft)}</span>
        <span className="text-primary-ink shrink-0 underline underline-offset-4">
          Change
        </span>
      </button>

      <Row label="Subtotal" value={formatMoney(sums.subtotalCents)} />
      <Row
        label={rate !== null ? `Tax · ${(rate * 100).toFixed(2)}%` : "Tax"}
        // No rate is not a zero rate. "$0" reads as a decision somebody made,
        // and on a first quote nobody has.
        value={rate !== null ? formatMoney(sums.taxCents) : "No rate set"}
      />

      <Separator className="my-3" />

      <div className="flex items-baseline justify-between gap-2">
        <span className="font-label text-xs uppercase">
          {changeOrder ? "This change" : "Total"}
        </span>
        <span className="text-2xl font-semibold tabular-nums">
          {formatMoney(sums.totalCents)}
        </span>
      </div>

      {changeOrder ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Agreed after{" "}
          {formatMoney(changeOrder.agreedPriceCents + sums.totalCents)}
        </p>
      ) : null}

      {sums.optionalCents > 0 ? (
        <p className="text-muted-foreground border-muted-foreground/30 mt-3 rounded-md border border-dashed px-2.5 py-2 text-xs leading-relaxed">
          She can add {formatMoney(sums.optionalCents)} more if she wants the
          optional rows. Not in the total above.
        </p>
      ) : null}

      {/* The rule is its own element rather than the button's top border: on
          a rounded button a border-top curls up at both ends. */}
      <Separator className="mt-4 mb-2" />

      <button
        type="button"
        onClick={onOpenTerms}
        className="hover:bg-muted/60 -mx-1.5 flex w-[calc(100%+0.75rem)] flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md px-1.5 py-1.5 text-left transition-colors"
      >
        {depositCents === null ? (
          <span className="text-primary-ink text-sm underline underline-offset-4">
            How you get paid
          </span>
        ) : (
          <>
            <span className="text-muted-foreground text-sm">
              Deposit — {draft.terms.depositPercent}%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-medium tabular-nums">
                {formatMoney(depositCents)}
              </span>
              <span className="text-primary-ink text-xs underline underline-offset-4">
                Change
              </span>
            </span>
          </>
        )}
      </button>
    </SectionCard>
  );
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
        <span className="font-label text-xs uppercase">
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-muted-foreground flex justify-between gap-2 py-1 text-sm">
      <span className="truncate">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export type { ChangeOrderContext };
