"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Camera, Library } from "lucide-react";

import { CapturePanel } from "@/components/quote-editor/capture-panel";
import { LibraryPanel } from "@/components/quote-editor/library/library-panel";
import { SaveToLibraryDialog } from "@/components/quote-editor/library/save-to-library-dialog";
import { SavedItemSheet } from "@/components/quote-editor/library/saved-item-sheet";
import {
  useJobItemSettings,
  useLibraryMutations,
  useSavedItems,
} from "@/components/quote-editor/library/use-library";
import {
  TOOL_TABS,
  ToolPanel,
  type ToolTab,
} from "@/components/quote-editor/tool-panel";
import { useTourStep } from "@/components/tours/current";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { useStickyChoice, useStickyToggle } from "@/hooks/use-sticky-toggle";
import {
  AcceptanceSection,
  HeaderSection,
  PricingSection,
  TermsSection,
  type OfficeIdentity,
} from "@/components/quote-editor/document-sections";
import { EditorHeader } from "@/components/quote-editor/editor-header";
import { MarginCheck } from "@/components/quote-editor/margin-check";
import {
  ScopeSection,
  type DropTarget,
  type ScopeUpdate,
} from "@/components/quote-editor/scope/scope-section";
import {
  ChangeMoneySection,
  ChangeTermsSection,
  SignedContractSection,
  type ChangeTarget,
} from "@/components/quote-editor/change-order-sections";
import {
  TermsSheet,
  type PhaseAssignments,
} from "@/components/quote-editor/terms-sheet";
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
import { expandSavedItem, resolveSettings, type SavedItem } from "@/lib/library";
import {
  customerDetail,
  insertNode,
  totals,
  withCustomerDetail,
  type ChangeOrderContext,
  type CustomerDetail,
  type EditorMode,
  type QuoteDraft,
  type QuoteTerms,
  type ScopeNode,
} from "@/lib/quote";
import { hasMod } from "@/lib/shortcuts";
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
 * Tour markers that live in the tool panel, and what a step on one needs: a
 * tab opened, or just the panel unfolded (`open`).
 */
const TOUR_PANEL: Record<string, ToolTab | "open"> = {
  "quote.tools": "open",
  "quote.library": "library",
  "quote.margin": "money",
  "quote.pricing": "money",
  "quote.terms": "money",
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
 * **At the desk: the document in the centre, the tools on the right.** One
 * panel with three tabs — Money (pricing, terms, acceptance and the private
 * margin), Library (saved items to drag into Scope) and Capture (what was
 * recorded on site) — with the total and margin pinned above the tabs. It folds
 * to a spine to give the document the full width, and remembers its tab and
 * whether it was folded, per browser (UX: Saved Items and Job Settings).
 *
 * **Below the desk the panel isn't docked.** Pricing, Terms and Acceptance come
 * down into the document, and Library and Capture open as a drawer from the
 * header — a bottom sheet on a phone, where a saved item is added with a tap
 * instead of a drag. Under ~768px it is the phone frame: sections collapsed to
 * a row each, Scope's rows opening a sheet, running total inline.
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
  onCreated,
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
  /**
   * Told once, when the first save gives a new quote its row — so the surface
   * can put the quote's own address in the bar, and a reload opens it.
   */
  onCreated?: (quoteId: string) => void;
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

  const onCreatedRef = useRef(onCreated);
  useEffect(() => {
    onCreatedRef.current = onCreated;
  });
  const createdId = initial.id ? null : draft.id;
  useEffect(() => {
    if (createdId) onCreatedRef.current?.(createdId);
  }, [createdId]);

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

  /** The tool panel docks beside the document at the desk; below it, drawers. */
  const docked = layout === "desk";
  const singleColumn = !docked;

  // Both remembered per browser: a contractor who folds the panel away, or
  // leaves it on the Library, shouldn't have to do it again on every quote.
  const [storedTab, setTab] = useStickyChoice<ToolTab>(
    "quote-editor:tool-tab",
    TOOL_TABS,
    "money"
  );
  const [storedFolded, setFolded] = useStickyToggle(
    "quote-editor:tools-folded",
    false
  );

  /** Library or Capture, open as a drawer below the desk. */
  const [drawer, setDrawer] = useState<"library" | "capture" | null>(null);
  const isMobile = useIsMobile();

  /**
   * The Job the captures and the job settings hang off. Null until the first
   * autosave creates one — there is nowhere to put either before then.
   */
  const currentJobId = draft.jobId ?? jobId ?? null;

  // The Library is the Office's, so it needs an Office: on while autosave is,
  // which is false only for the activation quote written before one exists.
  const libraryAvailable = autosave;

  // A tour step about part of the panel opens it to that part, so the step
  // isn't pointing at something behind another tab or a fold. Only where the
  // part exists — the docked panel, and a Library there's an Office for —
  // or a step could be left waiting on something that never appears.
  const tourStep = useTourStep();
  const tourPanel =
    docked && tourStep && (tourStep.anchor !== "quote.library" || libraryAvailable)
      ? TOUR_PANEL[tourStep.anchor]
      : undefined;
  const tab: ToolTab = tourPanel && tourPanel !== "open" ? tourPanel : storedTab;
  const folded = tourPanel ? false : storedFolded;

  // A panel the tour unfolded stays unfolded — snapping it shut again at the
  // next step would hide what the tour just pointed at.
  useEffect(() => {
    if (tourPanel && storedFolded) setFolded(false);
  }, [tourPanel, storedFolded, setFolded]);
  const library = useSavedItems(libraryAvailable);
  const jobSettings = useJobItemSettings(libraryAvailable ? currentJobId : null);
  const { recordUse } = useLibraryMutations(currentJobId);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const openItem = openItemId
    ? (library.items.find((item) => item.id === openItemId) ?? null)
    : null;
  const [savingNode, setSavingNode] = useState<ScopeNode | null>(null);

  const setScope = useCallback(
    (next: ScopeUpdate) =>
      update((current) => ({
        ...current,
        scope: typeof next === "function" ? next(current.scope) : next,
      })),
    [update]
  );

  // The terms, and which phase each top-level row is billed in — confirmed
  // together from "How you get paid". Only the phases are written onto the
  // rows, so an edit to a row since the sheet opened is kept.
  const setTerms = useCallback(
    (terms: QuoteTerms, phases?: PhaseAssignments) =>
      update((current) => ({
        ...current,
        terms,
        scope: phases
          ? current.scope.map((node) =>
              phases.has(node.key) && (node.phaseKey ?? null) !== phases.get(node.key)
                ? { ...node, phaseKey: phases.get(node.key) ?? null }
                : node
            )
          : current.scope,
      })),
    [update]
  );

  const setDetail = useCallback(
    (detail: CustomerDetail) =>
      update((current) => ({
        ...current,
        terms: withCustomerDetail(current.terms, detail),
      })),
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

  /**
   * Puts a saved item into Scope as ordinary rows, sized by this job's
   * settings where it has them and the Office's defaults where it doesn't.
   */
  function placeSavedItem(
    item: SavedItem,
    target: DropTarget = { parentKey: null, index: null }
  ) {
    const { values } = resolveSettings(
      item.settings,
      item.defaults,
      jobSettings[item.id]
    );
    const { node, problems } = expandSavedItem(item, values);
    setScope((scope) => insertNode(scope, node, target.parentKey, target.index));
    recordUse.mutate(item.id);

    if (problems.length) {
      toast.warning(`Added ${item.name}, with the saved numbers where a formula couldn't be worked out`, {
        description: problems.slice(0, 3).join(" · "),
      });
    }

    // Brought into view if it landed off screen — after the details panel that
    // added it has finished closing, since its scroll lock holds the page
    // still until then.
    window.setTimeout(() => {
      const row = document.querySelector(`[data-node-key="${CSS.escape(node.key)}"]`);
      if (!row) return;
      const { top, bottom } = row.getBoundingClientRect();
      if (top >= 80 && bottom <= window.innerHeight) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }, 350);
  }

  function dropSavedItem(savedItemId: string, target: DropTarget) {
    const item = library.items.find((candidate) => candidate.id === savedItemId);
    if (item) placeSavedItem(item, target);
  }

  function showLibrary() {
    if (docked) {
      setTab("library");
      setFolded(false);
    } else {
      setDrawer("library");
    }
  }

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

  // ⌘S saves now rather than opening the browser's save dialog; ⌘↵ is the
  // header's primary action. Ctrl on Windows and Linux.
  const previewRef = useRef(preview);
  useEffect(() => {
    previewRef.current = preview;
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!hasMod(event) || event.altKey || event.shiftKey) return;
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        if (!autosave) return;
        void saveNow().then((saved) => {
          if (saved) toast.success("Saved");
        });
      } else if (event.key === "Enter") {
        // Not from inside a dialog — the terms sheet has its own Enter.
        if ((event.target as HTMLElement).closest?.("[role=dialog]")) return;
        event.preventDefault();
        void previewRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autosave, saveNow]);

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
    <div
      ref={frame}
      // The app's single-letter shortcuts stay off while the editor is open.
      data-letter-shortcuts="off"
      className="@container flex flex-1 flex-col"
    >
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
            {/* Below the desk the tools have no panel, so they open from here. */}
            {/* Icons only: the bar is already full at these widths, and the
                customer's name is the thing it must not squeeze out. On a
                phone there's no room at all, so they sit above the document. */}
            {!docked && !compact ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" data-tour={libraryAvailable ? "quote.library" : undefined} onClick={() => setDrawer("library")} aria-label="Library">
                      <Library />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Library</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" data-tour="quote.capture" onClick={() => setDrawer("capture")} aria-label="Capture">
                      <Camera />
                      {captures.length ? <span className="text-muted-foreground text-xs tabular-nums">{captures.length}</span> : null}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Capture</TooltipContent>
                </Tooltip>
              </>
            ) : null}
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
                  // 340 open: two columns of Library tiles, and the money cards
                  // with room for a name and the line saying what they hold.
                  gridTemplateColumns: `minmax(0,1fr) ${folded ? "48px" : "340px"}`,
                }
          }
        >
          {/* Its own container, so the sections inside pad themselves for the
              width this column actually has rather than the whole editor's. */}
          <div className="@container flex min-w-0 flex-col gap-4 p-3 @2xl:gap-5 @2xl:p-5">
            {compact ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" data-tour={libraryAvailable ? "quote.library" : undefined} onClick={() => setDrawer("library")}>
                  <Library />
                  Library
                </Button>
                <Button variant="outline" size="sm" className="flex-1" data-tour="quote.capture" onClick={() => setDrawer("capture")}>
                  <Camera />
                  Capture
                  {captures.length ? <span className="text-muted-foreground text-xs tabular-nums">{captures.length}</span> : null}
                </Button>
              </div>
            ) : null}

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
              onSaveToLibrary={libraryAvailable ? setSavingNode : undefined}
              detail={customerDetail(draft.terms)}
              // A change order's page lists what changed, row by row; the
              // choice is a quote's.
              onDetail={mode === "change-order" ? undefined : setDetail}
              onDropSavedItem={docked && libraryAvailable ? dropSavedItem : undefined}
            />

            {/* 3–5 · Pricing, Terms and Acceptance, below the desk. They come
                down into the document rather than disappearing — the total is
                never behind a tap. */}
            {!docked ? (
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

          {docked ? (
            <div className="border-l">
              {/* Sticky under the pinned header and capped at the screen's
                  height, so the totals and tabs never scroll away on a long
                  quote and each tab scrolls inside the panel. */}
              <ToolPanel
                draft={draft}
                sums={sums}
                tab={tab}
                onTab={setTab}
                collapsed={folded}
                onCollapsed={setFolded}
                counts={{
                  library: library.items.length,
                  capture: captures.length,
                }}
                libraryTour={libraryAvailable}
                className="bg-background sticky top-16 h-[calc(100svh-4rem)]"
                money={
                  <>
                    {/* Not part of the document — the customer never sees it. */}
                    <MarginCheck draft={draft} />
                    {moneySections}
                  </>
                }
                library={
                  <LibraryPanel
                    items={library.items}
                    loading={library.loading}
                    error={library.error}
                    available={libraryAvailable}
                    jobSettings={jobSettings}
                    draggable
                    onOpen={(item) => setOpenItemId(item.id)}
                  />
                }
                capture={
                  <CapturePanel
                    captures={captures}
                    jobId={currentJobId}
                    className="min-h-0 flex-1"
                  />
                }
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Below the desk: Library and Capture as a drawer — from the right on a
          tablet, a bottom sheet on a phone. */}
      {!docked && drawer ? (
        <Sheet open onOpenChange={(open) => !open && setDrawer(null)}>
          <SheetContent
            side={isMobile ? "bottom" : "right"}
            className={cn(
              "gap-0 p-0",
              isMobile ? "h-[85svh]" : "w-full sm:max-w-sm"
            )}
            // Not into the search box: on a phone that opens the keyboard
            // over the tiles before anyone asked to type.
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <div className="border-b px-4 py-3 pr-12">
              <SheetTitle className="text-base">
                {drawer === "library" ? "Library" : "Capture"}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {drawer === "library"
                  ? "Tap a saved item to see what it adds and put it in Scope."
                  : "What was recorded on site."}
              </SheetDescription>
            </div>
            {drawer === "library" ? (
              <LibraryPanel
                items={library.items}
                loading={library.loading}
                error={library.error}
                available={libraryAvailable}
                jobSettings={jobSettings}
                draggable={false}
                onOpen={(item) => {
                  setDrawer(null);
                  setOpenItemId(item.id);
                }}
              />
            ) : (
              <CapturePanel
                captures={captures}
                jobId={currentJobId}
                className="min-h-0 flex-1 overflow-y-auto"
              />
            )}
          </SheetContent>
        </Sheet>
      ) : null}

      {openItem ? (
        <SavedItemSheet
          item={openItem}
          jobId={currentJobId}
          jobValues={jobSettings[openItem.id] ?? null}
          onOpenChange={(open) => !open && setOpenItemId(null)}
          onAdd={(item) => placeSavedItem(item)}
        />
      ) : null}

      {savingNode ? (
        <SaveToLibraryDialog
          node={savingNode}
          onOpenChange={(open) => !open && setSavingNode(null)}
          onSaved={() =>
            toast.success("Saved to your library", {
              action: { label: "Show", onClick: showLibrary },
            })
          }
        />
      ) : null}

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
