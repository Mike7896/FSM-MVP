import { AlertCircle, ArrowRight, Check, Clock, Hammer } from "lucide-react";

import type { StageTone } from "@/lib/billing/stage";
import { cn } from "@/lib/utils";

const TONES: Record<StageTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  active: "bg-primary/15 text-primary-ink",
  action: "bg-primary text-primary-foreground",
  waiting: "bg-muted text-foreground",
  overdue: "bg-destructive/10 text-destructive",
  done: "bg-positive/12 text-positive",
};

const ICONS: Partial<Record<StageTone, typeof Check>> = {
  active: Hammer,
  action: ArrowRight,
  waiting: Clock,
  overdue: AlertCircle,
  done: Check,
};

/**
 * Where a job or an invoice stands, as a coloured label: amber when it's the
 * contractor's move, grey while waiting on someone else, red when that wait has
 * gone on too long, green when it's paid.
 */
export function StagePill({
  label,
  tone,
  size = "sm",
  className,
}: {
  label: string;
  tone: StageTone;
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = ICONS[tone];

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "md" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs",
        TONES[tone],
        className
      )}
    >
      {Icon ? <Icon className={size === "md" ? "size-3.5" : "size-3"} /> : null}
      {label}
    </span>
  );
}
