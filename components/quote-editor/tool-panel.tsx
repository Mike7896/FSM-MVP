"use client";

import type { ReactNode } from "react";
import {
  Camera,
  CircleDollarSign,
  Library,
  Lock,
  PanelRightClose,
  PanelRightOpen,
  type LucideIcon,
} from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatMoney, margin, type QuoteDraft, type QuoteTotals } from "@/lib/quote";
import { cn } from "@/lib/utils";

export type ToolTab = "money" | "library" | "capture";
export const TOOL_TABS = ["money", "library", "capture"] as const satisfies readonly ToolTab[];

const TABS: Record<ToolTab, { label: string; icon: LucideIcon }> = {
  money: { label: "Money", icon: CircleDollarSign },
  library: { label: "Library", icon: Library },
  capture: { label: "Capture", icon: Camera },
};

/**
 * The editor's tools, on the right — Money, Library and Capture as tabs, with
 * the total and margin pinned above them so the price stays in view whichever
 * tab is open (UX: Saved Items and Job Settings, "Editor layout").
 *
 * It folds to a narrow spine to give the document the width; the spine's
 * icons open the panel straight onto that tab.
 */
export function ToolPanel({
  draft,
  sums,
  tab,
  onTab,
  collapsed,
  onCollapsed,
  counts,
  money,
  library,
  capture,
  libraryTour = false,
  className,
}: {
  draft: QuoteDraft;
  sums: QuoteTotals;
  tab: ToolTab;
  onTab: (tab: ToolTab) => void;
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
  /** Shown beside a tab's name — how many captures, how many saved items. */
  counts: Partial<Record<ToolTab, number>>;
  money: ReactNode;
  library: ReactNode;
  capture: ReactNode;
  /**
   * Mark the Library for the first-quote tour's step about it — only where
   * there's an Office for a Library to belong to.
   */
  libraryTour?: boolean;
  className?: string;
}) {
  if (collapsed) {
    return (
      // Folded, the spine is the panel — the tour's step about the tools points
      // here, and opens it.
      <div
        data-tour="quote.tools"
        className={cn("flex flex-col items-center gap-1 py-3", className)}
      >
        <SpineButton
          label="Open the tools"
          onClick={() => onCollapsed(false)}
          icon={PanelRightOpen}
        />
        <div className="my-1 h-px w-6 bg-border" />
        {TOOL_TABS.map((key) => (
          <SpineButton
            key={key}
            label={TABS[key].label}
            icon={TABS[key].icon}
            count={counts[key]}
            tour={key === "library" && libraryTour ? "quote.library" : undefined}
            onClick={() => {
              onTab(key);
              onCollapsed(false);
            }}
          />
        ))}
        {/* The total survives the fold, so the price never leaves the screen. */}
        <span className="text-foreground mt-3 font-semibold tabular-nums [writing-mode:vertical-rl] text-sm">
          {formatMoney(sums.totalCents)}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <TotalsStrip draft={draft} sums={sums} />

      <Tabs
        value={tab}
        onValueChange={(value) => onTab(value as ToolTab)}
        className="min-h-0 flex-1 gap-0"
      >
        <div data-tour="quote.tools" className="flex items-center gap-1 border-b px-2">
          <TabsList variant="line" className="h-10 flex-1 justify-start">
            {TOOL_TABS.map((key) => {
              const Icon = TABS[key].icon;
              return (
                <TabsTrigger
                  key={key}
                  value={key}
                  data-tour={key === "library" && libraryTour ? "quote.library" : undefined}
                  className="flex-none px-2 text-[13px]"
                >
                  <Icon className="size-3.5" />
                  {TABS[key].label}
                  {counts[key] ? (
                    <span className="text-muted-foreground text-[11px] tabular-nums">
                      {counts[key]}
                    </span>
                  ) : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onCollapsed(true)}
                className="text-muted-foreground hover:text-foreground hover:bg-muted flex size-7 shrink-0 items-center justify-center rounded transition-colors"
              >
                <PanelRightClose className="size-4" />
                <span className="sr-only">Fold the tools away</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Fold away</TooltipContent>
          </Tooltip>
        </div>

        {/* Kept mounted behind the other tabs, as the money rail always was:
            the first-quote tour counts its steps by what's on the page, and
            the margin and pricing it points at have to be there to count. */}
        <TabsContent
          value="money"
          forceMount
          className="min-h-0 overflow-y-auto [scrollbar-width:thin] data-[state=inactive]:hidden"
        >
          <div className="@container flex flex-col gap-4 p-4">{money}</div>
        </TabsContent>
        <TabsContent value="library" className="flex min-h-0 flex-col">
          {library}
        </TabsContent>
        <TabsContent value="capture" className="flex min-h-0 flex-col">
          {capture}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Total and margin, above the tabs. Margin is the private one — it never
 * reaches anything the customer can open — so it says so.
 */
function TotalsStrip({ draft, sums }: { draft: QuoteDraft; sums: QuoteTotals }) {
  const result = margin(draft);
  const hasMargin = result.marginPercent !== null;

  return (
    <div className="flex items-end justify-between gap-3 border-b px-4 py-3">
      <div className="min-w-0">
        <span className="text-muted-foreground font-label block text-[10px] uppercase">
          Total
        </span>
        <span className="block text-xl leading-tight font-bold tracking-tight tabular-nums">
          {formatMoney(sums.totalCents)}
        </span>
        {sums.optionalCents > 0 ? (
          <span className="text-muted-foreground block text-[11px] tabular-nums">
            +{formatMoney(sums.optionalCents)} optional
          </span>
        ) : null}
      </div>
      <div className="text-right">
        <span className="text-muted-foreground font-label flex items-center justify-end gap-1 text-[10px] uppercase">
          <Lock className="size-2.5" />
          Margin
        </span>
        <span
          className={cn(
            "block text-sm font-semibold tabular-nums",
            !hasMargin && "text-muted-foreground font-normal",
            hasMargin && result.marginCents > 0 && "text-positive",
            hasMargin && result.marginCents < 0 && "text-negative"
          )}
        >
          {hasMargin ? `${result.marginPercent}%` : "No costs yet"}
        </span>
        {hasMargin && !result.complete ? (
          <span className="text-muted-foreground block text-[11px]">
            Rows with a cost only
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SpineButton({
  label,
  icon: Icon,
  count,
  tour,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  count?: number;
  tour?: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          data-tour={tour}
          className="text-muted-foreground hover:text-foreground hover:bg-muted relative flex size-8 items-center justify-center rounded-md transition-colors"
        >
          <Icon className="size-4" />
          {count ? (
            <span className="bg-muted text-foreground absolute -top-0.5 -right-0.5 rounded-full px-1 text-[9px] leading-3.5 tabular-nums">
              {count}
            </span>
          ) : null}
          <span className="sr-only">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}
