"use client";

import {
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

import { CapturePanel } from "@/components/quote-editor/capture-panel";
import { useStickyToggle } from "@/hooks/use-sticky-toggle";
import {
  AcceptanceSection,
  HeaderSection,
  PricingSection,
  TermsSection,
  type OfficeIdentity,
} from "@/components/quote-editor/document-sections";
import { EditorHeader } from "@/components/quote-editor/editor-header";
import { MarginCheck } from "@/components/quote-editor/margin-check";
import { ScopeSection } from "@/components/quote-editor/scope/scope-section";
import {
  ChangeMoneySection,
  ChangeTermsSection,
  SignedContractSection,
  type ChangeTarget,
} from "@/components/quote-editor/change-order-sections";
import { TermsSheet } from "@/components/quote-editor/terms-sheet";
import { useLayoutMode } from "@/components/quote-editor/use-layout-mode";
import { useQuoteDraft } from "@/components/quote-editor/use-quote-draft";
import { StoredSignature } from "@/components/office/stored-signature";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import type { OfficeSignature } from "@/lib/signing/lines";
import type { CaptureItem } from "@/lib/queries/captures";
import {
  totals,
  type ChangeOrderContext,
  type EditorMode,
  type QuoteDraft,
  type QuoteTerms,
  type ScopeNode,
} from "@/lib/quote";
import { emitTourEvent } from "@/lib/tours";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * What a surface can ask of the editor from outside: flush the draft and hand
 * back the saved row. The send needs the quote's id before it can go, and only
 * the editor knows when its last write has landed.
 */
export type QuoteEditorController = {
  saveNow: () => Promise<QuoteDraft | null>;
};

/**
 * **The** quote editor — one screen at two fidelities.
 *
 * The contractor who has just signed up and the one on their four-hundredth
 * quote are using the same tool. The activation flow is this editor with the
 * onboarding tour over it, not a separate screen that happens to look similar — two
 * editors would drift, and the one that drifts is always the one the new
 * contractor sees first.
 *
 * **Five sections, always in this order: Header · Scope · Pricing · Terms ·
 * Acceptance.** They differ by who fills them in, which is what makes them an
 * editor decomposition rather than a page layout — Header is a lookup, Pricing
 * a calculation, Terms a derivation, Acceptance a state transition. Only Scope
 * is authored, so Scope gets the screen and the other four get a line each
 * until width buys them a rail. That ratio is the design.
 *
 * **Three columns at the desk: capture · quote · numbers** (19a). The desk
 * frame has to carry something real the phone does not — the capture panel
 * beside the sections and the margin view — or it is the phone version with
 * more whitespace, which is the one failure the second platform cannot afford.
 * Nothing moves between the columns and nothing collapses at full width: he
 * learns the geography once.
 *
 * **Below the desk, one chosen degradation.** The numbers column folds into the
 * centre first, so the capture-beside-editor adjacency — which is the whole
 * point of the desk — survives down to about 768px. Under that it is the phone
 * frame: three sections collapsed to a row each, Scope's rows opening a sheet,
 * running total inline.
 *
 * Everything is measured from **this component's own container**, never the
 * viewport: the editor is mounted in a wide page and in a narrow activation
 * column on the same screen, so "how big is the window" is the wrong question.
 */
export function QuoteEditor({
  initial,
  saveRequest,
  office,
  mode = "quote",
  changeOrder,
  jobId,
  customerId,
  address,
  packId,
  captures = [],
  autosave = true,
  demo = false,
  controllerRef,
  onPreview,
  onBack,
  previewLabel = "Preview & send",
  headerActions,
  changeTargets = [],
  changePanels,
  onOfficeChange,
}: {
  /** A loaded quote, or an empty draft for a new one. */
  initial: QuoteDraft;
  saveRequest?: (draft: QuoteDraft) => Promise<Response>;
  /** What the Header section looks up. The shop supplies; the document reads. */
  office: OfficeIdentity;
  /**
   * Told when the Office changes from inside the editor — its signature,
   * adopted from Acceptance — so the surface's preview reads the same Office.
   */
  onOfficeChange?: (office: OfficeIdentity) => void;
  mode?: EditorMode;
  changeOrder?: ChangeOrderContext;
  /** The signed contract's priced lines, which a change can act on. */
  changeTargets?: ChangeTarget[];
  /**
   * A change order's own panels for the money column — its schedule and its
   * billing — which belong to the surface that saves them.
   */
  changePanels?: ReactNode;
  /** Create-time context the draft does not carry. */
  jobId?: string;
  customerId?: string;
  address?: string;
  packId?: string;
  /** What was recorded on site. Read-only here; the walkthrough owns it. */
  captures?: CaptureItem[];
  autosave?: boolean;
  /**
   * A demo quote — the chip in the header, and the flag on the first save. The
   * same editor in every other respect (14a).
   */
  demo?: boolean;
  /** Lets the surface flush the draft before it sends. */
  controllerRef?: Ref<QuoteEditorController>;
  onPreview?: (draft: QuoteDraft) => void | Promise<void>;
  onBack?: () => void;
  previewLabel?: string;
  /**
   * Controls for the editor's own bar, beside the save state — the activation
   * flow puts "Show me around" here. A slot rather than a flag, so the editor
   * does not learn what they are for.
   */
  headerActions?: ReactNode;
}) {
  const { draft, update, status, error, saveNow } = useQuoteDraft({
    initial,
    saveRequest,
    jobId,
    customerId,
    address,
    packId,
    demo,
    autosave,
  });

  useImperativeHandle(controllerRef, () => ({ saveNow }), [saveNow]);

  const frame = useRef<HTMLDivElement>(null);
  const layout = useLayoutMode(frame);

  const [termsOpen, setTermsOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);

  /**
   * The Office's signature as this screen last heard it. Adopted from the
   * Acceptance section's dialog it changes here at once, rather than waiting
   * for a reload — and goes up to the surface, so the preview's lines agree.
   */
  const [signatureChange, setSignatureChange] = useState<{
    value: OfficeSignature | null;
  } | null>(null);
  const signature = signatureChange ? signatureChange.value : office.signature;

  function changeSignature(value: OfficeSignature | null) {
    setSignatureChange({ value });
    onOfficeChange?.({ ...office, signature: value });
  }
  // Header collapses to one line on a phone and opens in place. It is a lookup
  // — correcting a name is a rare act, and it does not deserve a sheet.
  const [headerOpen, setHeaderOpen] = useState(false);

  const sums = useMemo(() => totals(draft), [draft]);

  const compact = layout === "compact";
  const hasCaptures = captures.length > 0;

  // Remembered per browser: a contractor who folds it away on a small screen
  // should not have to fold it away again on every quote.
  const [captureFolded, setCaptureFolded] = useStickyToggle(
    "quote-editor:capture-folded",
    false
  );

  /**
   * The Job the captures hang off. Null until the first autosave creates one —
   * a capture belongs to a Job, so there is nowhere to put one before then.
   */
  const captureJobId = draft.jobId ?? jobId ?? null;

  /**
   * **Capture is part of the editor, so it is always there.** The adjacency —
   * what happened on site beside the quote written from it — is Mode B, and
   * the whole argument for a second platform. A panel that appears only once
   * there is something in it is a feature a contractor never learns they have:
   * it was hidden on the two occasions they would have met it, a brand-new
   * quote and an empty one.
   *
   * It used to require captures, then a saved Job. Both were the same mistake.
   * What it needs instead is an honest empty state, which it now has, and a
   * way to fold it out of the road, which it also now has.
   *
   * Only the phone is exempt: three columns do not fit, and capture there is
   * the job's own screen rather than a column beside a document.
   */
  const showCapture = !compact;

  /**
   * The numbers column folds first — the chosen degradation, so the capture
   * adjacency survives to ~768px. With no capture column there is room for it
   * at tablet width too, so the width still buys something.
   */
  const showRail =
    layout === "desk" || (layout === "tablet" && (captureFolded || !hasCaptures));

  const singleColumn = compact || (!showCapture && !showRail);

  // Folded, the column keeps a spine — narrow enough to give the quote the
  // room, wide enough to say what it is and how many things are in it.
  //
  // 280 rather than 19a's 330: at a 1440 laptop the sidebar, this and the rail
  // left the quote itself ~520px, and Scope's rows wrapped their quantity,
  // unit and price onto three lines. A capture row is a 56px thumbnail and a
  // sentence, and it reads fine at 280.
  const captureWidth = captureFolded
    ? "44px"
    : layout === "desk"
      ? "280px"
      : "264px";

  const setScope = useCallback(
    (scope: ScopeNode[]) => update((current) => ({ ...current, scope })),
    [update]
  );

  const setTerms = useCallback(
    (terms: QuoteTerms) => update((current) => ({ ...current, terms })),
    [update]
  );

  const patch = useCallback(
    (fields: Partial<QuoteDraft>) =>
      update((current) => ({ ...current, ...fields })),
    [update]
  );

  const router = useRouter();
  async function openInfoRequest() {
    setPreparing(true);
    try {
      const saved = await saveNow();
      if (!saved?.id) throw new Error("Save the quote before asking for information.");
      router.push(`/quotes/${saved.id}/info-request`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't save the quote.");
      setPreparing(false);
    }
  }

  const setNarrative = useCallback(
    (scopeOfWork: string) => update((current) => ({ ...current, scopeOfWork })),
    [update]
  );

  /** Flush before handing off, so the preview reads the persisted document. */
  async function preview() {
    emitTourEvent("quote.previewed");
    setPreparing(true);
    try {
      // Only while autosave is on. Activation previews before the Office
      // exists, when there is nowhere to write the quote yet — the send
      // flushes it once there is.
      const saved = autosave ? await saveNow() : null;
      // The row's identity from the write that just landed. A first quote has
      // no id until then, and what comes after the preview needs one.
      await onPreview?.(
        saved
          ? {
              ...draft,
              id: saved.id,
              number: saved.number,
              jobId: saved.jobId,
              customerId: saved.customerId,
              status: saved.status,
            }
          : draft
      );
    } finally {
      setPreparing(false);
    }
  }

  /**
   * Pricing, Terms and Acceptance — the three that move to the rail at the desk
   * and come back into the document when it folds. Written once and placed
   * twice, because a rail and a panel showing different numbers for the same
   * money at two window sizes is the bug this editor cannot afford.
   */
  const moneySections = mode === "change-order" ? (
    // A change's money: the contract, the change and the total after it —
    // then its schedule and billing, and a word on the terms, which don't
    // change with the work.
    <>
      <ChangeMoneySection
        draft={draft}
        sums={sums}
        agreedPriceCents={changeOrder?.agreedPriceCents ?? 0}
        onTaxRate={(taxRate) => patch({ taxRate })}
      />
      {changePanels}
      <ChangeTermsSection />
    </>
  ) : (
    <>
      <PricingSection
        draft={draft}
        sums={sums}
        onOpenTerms={() => setTermsOpen(true)}
        changeOrder={changeOrder}
      />
      <TermsSection
        draft={draft}
        sums={sums}
        onOpenTerms={() => setTermsOpen(true)}
      />
      <AcceptanceSection
        customerName={draft.customerName}
        businessName={office.businessName}
        signatureLines={draft.signatureLines}
        onSignatureLines={(signatureLines) => patch({ signatureLines })}
        signature={signature}
        // A signature is the Office's, so there has to be an Office to keep
        // it — activation writes the quote before one exists.
        onEditSignature={autosave ? () => setSignatureOpen(true) : undefined}
      />
    </>
  );

  return (
    /**
     * **The editor is the content region, not a card sitting in it.**
     *
     * No max-width, no outer border, no rounded corners: 13a is explicit that
     * the editor takes the whole content region and is not a modal, with the
     * destination nav still beside it.
     *
     * The page is the scroll container and the header is pinned to the top of
     * it, rather than each column scrolling in its own box. A work surface that
     * scrolls like every other page is worth more than independently scrolling
     * panes.
     */
    <div ref={frame} className="@container flex flex-1 flex-col">
      <div className="bg-background flex flex-1 flex-col">
        <EditorHeader
          draft={draft}
          status={status}
          error={error}
          previewLabel={previewLabel}
          onPreview={preview}
          preparing={preparing}
          onBack={onBack}
          actions={<>
            {headerActions}
            {autosave && mode !== "change-order" && <Button variant="outline" size="sm" disabled={preparing} onClick={openInfoRequest}>Ask for info</Button>}
          </>}
          demo={demo}
          kind={mode === "change-order" ? "Change order" : undefined}
          // On a phone the header scrolls away, so the action lives at the foot
          // of the document instead (4e). At the desk it belongs up here, where
          // it is reachable from the first second at any scroll position.
          showAction={!compact}
        />

        <div
          // A tinted ground under the section cards, so each one has an edge.
          // Five sections sharing one background read as one long form. In
          // dark the cards carry their own fill, so the ground is the page's.
          className={cn(
            "bg-muted/30 dark:bg-transparent flex-1",
            singleColumn ? "flex flex-col" : "grid"
          )}
          style={
            singleColumn
              ? undefined
              : {
                  // 19a's frame. Fixed roles: what happened on site, the quote,
                  // the money — in that order, whichever of them are present.
                  gridTemplateColumns: [
                    showCapture && captureWidth,
                    "minmax(0,1fr)",
                    // 300, not 250: the rail's cards carry a name and a line
                    // saying what they hold, and at 260 that line wrapped
                    // into a three-line stack beside a squeezed Change link.
                    showRail && "300px",
                  ]
                    .filter(Boolean)
                    .join(" "),
                }
          }
        >
          {showCapture ? (
            // The divider runs the column's full height; the panel inside it
            // sticks under the header like the rail does. Without that its
            // drop zone sat at the foot of a column as tall as the quote —
            // two thousand pixels below the empty state that mentions it.
            <div className="border-r">
              <CapturePanel
                captures={captures}
                jobId={captureJobId}
                collapsed={captureFolded}
                onCollapsedChange={setCaptureFolded}
                className="sticky top-16 max-h-[calc(100svh-4rem)]"
              />
            </div>
          ) : null}

          {/* Its own container, so the sections inside pad themselves for the
              width this column actually has rather than the whole editor's. */}
          <div className="@container flex min-w-0 flex-col gap-4 p-3 @2xl:gap-5 @2xl:p-5">
            {/* 1 · Header — a lookup. One line on a phone, open at the desk. */}
            <HeaderSection
              draft={draft}
              office={office}
              address={address}
              onChange={patch}
              collapsed={compact && !headerOpen}
              onExpand={() => setHeaderOpen(true)}
              changeOrder={mode === "change-order" ? changeOrder : undefined}
            />

            {/* A change order's own middle: the contract it amends, line by
                line, between who it's for and what's changing. */}
            {mode === "change-order" && changeOrder ? (
              <SignedContractSection
                targets={changeTargets}
                draft={draft}
                onScope={setScope}
                contractNumber={changeOrder.contractNumber}
                agreedPriceCents={changeOrder.agreedPriceCents}
              />
            ) : null}

            {/* 2 · Scope — the only authored section, and the only one whose
                structure varies. It gets the screen at every width. */}
            <ScopeSection
              draft={draft}
              onScope={setScope}
              onNarrative={setNarrative}
              mode={compact ? "read" : "edit"}
              change={mode === "change-order"}
            />

            {/* 3–5 · Pricing, Terms and Acceptance, when the rail has folded.
                They come down into the document rather than disappearing —
                the total is the thing he is anxious about and it is never
                behind a tap. */}
            {!showRail ? (
              <>
                {moneySections}
                {compact ? (
                  <Button
                    data-tour="quote.preview"
                    size="lg"
                    className="w-full"
                    onClick={preview}
                  >
                    {previewLabel}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>

          {showRail ? (
            // A container too: the cards in a 300px rail take the rail's
            // padding, not the desk-wide padding the editor's width implies.
            <div className="@container border-l">
              {/* Sticky *under* the pinned header — the total must not scroll
                  away on a long quote. The offset clears the header rather
                  than sliding beneath it. Capped at the screen's height, so a
                  short window scrolls the rail instead of leaving Acceptance
                  below the fold for good. */}
              <div className="sticky top-16 flex max-h-[calc(100svh-4rem)] flex-col gap-4 overflow-y-auto p-4 [scrollbar-width:thin]">
                {/* Margin leads the rail: it is what he is deliberating over,
                    and it is the desk's other reason to exist. It is not a
                    section of the document — she can never reach it. */}
                <MarginCheck draft={draft} />
                {moneySections}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Mounted only while open, so each opening re-seeds its own copy of the
          terms from the draft without an effect to synchronise them. */}
      {termsOpen ? (
        <TermsSheet
          open
          onOpenChange={setTermsOpen}
          draft={draft}
          customerName={draft.customerName}
          onChange={setTerms}
        />
      ) : null}

      {/* The Office's own signature form, not a copy of it — the Defaults page
          and this dialog save the same thing through the same route. Mounted
          only while open, so it starts from what the Office keeps now. */}
      {signatureOpen ? (
        <ResponsiveDialog open onOpenChange={setSignatureOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader
              title="Your signature"
              description="It goes on the business's line of your quotes and contracts. Saved to your Office, so you only do this once."
            />
            <ResponsiveDialogBody>
              <StoredSignature
                bare
                stored={{
                  printedName: signature?.printedName ?? null,
                  mark: signature?.mark ?? null,
                  autoSign: signature?.autoSign ?? true,
                }}
                personName={null}
                onChange={(next) => {
                  changeSignature(next);
                  // Adopted or applied: the line is filled, so the dialog has
                  // done its job. Removed: stay, so it can be replaced.
                  if (next?.autoSign) setSignatureOpen(false);
                }}
              />
            </ResponsiveDialogBody>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      ) : null}
    </div>
  );
}
