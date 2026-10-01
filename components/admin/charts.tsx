"use client";

import { cn } from "@/lib/utils";

/**
 * Small, honest charts — bars in a row, the value on hover, the max written
 * down. No library: a dashboard of twenty of these should cost nothing to draw.
 */

export function Bars({
  values,
  labels,
  format = (value) => String(value),
  className,
  tone = "bg-primary",
  highlightLast = true,
}: {
  values: number[];
  labels: string[];
  format?: (value: number) => string;
  className?: string;
  tone?: string;
  highlightLast?: boolean;
}) {
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex h-24 items-end gap-[2px]">
        {values.map((value, index) => (
          <div
            key={index}
            title={`${labels[index]}: ${format(value)}`}
            className={cn(
              "min-w-0 flex-1 rounded-t-[2px] transition-[height]",
              value === 0 ? "bg-muted" : tone,
              highlightLast && index === values.length - 1 ? "opacity-100" : "opacity-70 hover:opacity-100"
            )}
            style={{ height: `${value === 0 ? 2 : Math.max(4, (value / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="text-muted-foreground flex justify-between text-[10px] tabular-nums">
        <span>{labels[0]}</span>
        <span>
          max {format(max === 1 && total === 0 ? 0 : max)} · total {format(total)}
        </span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

/** One row of a funnel: the bar is the share of the first step. */
export function FunnelRow({ label, value, first, previous }: { label: string; value: number; first: number; previous: number | null }) {
  const share = first > 0 ? value / first : 0;
  const step = previous && previous > 0 ? value / previous : null;
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)_5.5rem] items-center gap-3 text-xs">
      <span className="truncate">{label}</span>
      <span className="bg-muted relative h-4 overflow-hidden rounded-sm">
        <span className="bg-primary/70 absolute inset-y-0 left-0" style={{ width: `${Math.max(share * 100, value ? 1 : 0)}%` }} />
      </span>
      <span className="text-right tabular-nums">
        {value}
        <span className="text-muted-foreground">
          {step === null ? "" : ` · ${Math.round(step * 100)}%`}
        </span>
      </span>
    </div>
  );
}
