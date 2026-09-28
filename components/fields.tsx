"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Shared quote-editor fields with visible resting, hover, and focus states. */

type Size = "sm" | "md";

/**
 * `<input size>` is an HTML attribute meaning "width in characters", and it is
 * not what anyone means here. Shadowing it with the design's two sizes is the
 * right trade — nothing in this app sets the character-count attribute — but it
 * has to be omitted explicitly or the two collide.
 */
type FieldProps = Omit<React.ComponentProps<typeof Input>, "size"> & {
  size?: Size;
};

const CONTROL: Record<Size, string> = {
  sm: "h-7 text-xs",
  md: "h-8 text-sm",
};

/* ── Document text that happens to be editable ────────────────────────── */

/** A single editable line, visibly framed even before interaction. */
export function EditableText({
  className,
  tone = "body",
  ...props
}: React.ComponentProps<typeof Input> & {
  /** How loudly it reads at rest, matching the document around it. */
  tone?: "title" | "body" | "muted";
}) {
  return (
    <Input
      {...props}
      className={cn(
        "h-auto min-h-10 rounded-lg border border-input bg-muted/25 px-3 py-2 shadow-none dark:bg-input/30",
        "transition-colors hover:border-muted-foreground/60 hover:bg-muted/40",
        "focus-visible:bg-background focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 dark:focus-visible:bg-input/40",
        tone === "title" && "text-base font-semibold @lg:text-lg",
        tone === "body" && "text-sm md:text-sm",
        tone === "muted" && "text-muted-foreground text-sm md:text-sm",
        className,
      )}
    />
  );
}

/** The same idea for prose. Auto-grows — `field-sizing-content` is on the base. */
export function EditableParagraph({
  className,
  tone = "body",
  ...props
}: React.ComponentProps<typeof Textarea> & {
  tone?: "body" | "muted";
}) {
  return (
    <Textarea
      {...props}
      className={cn(
        "min-h-20 resize-y rounded-lg border border-input bg-muted/25 px-3 py-2.5 shadow-none dark:bg-input/30",
        "leading-relaxed transition-colors hover:border-muted-foreground/60 hover:bg-muted/40",
        "focus-visible:bg-background focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 dark:focus-visible:bg-input/40",
        tone === "body" && "text-sm md:text-sm",
        tone === "muted" && "text-muted-foreground text-sm md:text-sm",
        className,
      )}
    />
  );
}

/* ── Instruments ──────────────────────────────────────────────────────── */

/**
 * An amount, with the currency mark inside the field.
 *
 * The mark is a sibling rather than a prefix in the value, so the input still
 * holds a plain number the parser can read, and the field keeps a **fixed
 * width**: a money column that resizes between "$95" and "$1,240" makes the
 * whole row jump while a contractor is typing into it.
 */
export function MoneyInput({
  className,
  size = "md",
  ...props
}: FieldProps) {
  return (
    <div className={cn("relative shrink-0", size === "sm" ? "w-24" : "w-32")}>
      <span
        aria-hidden
        className={cn(
          "text-muted-foreground pointer-events-none absolute top-1/2 -translate-y-1/2",
          size === "sm" ? "left-2 text-xs" : "left-2.5 text-sm",
        )}
      >
        $
      </span>
      <Input
        inputMode="decimal"
        {...props}
        className={cn(
          CONTROL[size],
          "text-right tabular-nums",
          size === "sm" ? "pr-2 pl-5" : "pr-2.5 pl-6",
          className,
        )}
      />
    </div>
  );
}

/** A quantity. Centred and tabular, so a column of them reads as a column. */
export function NumberInput({
  className,
  size = "md",
  ...props
}: FieldProps) {
  return (
    <Input
      inputMode="decimal"
      {...props}
      className={cn(
        CONTROL[size],
        "shrink-0 px-1 text-center tabular-nums",
        size === "sm" ? "w-12" : "w-16",
        className,
      )}
    />
  );
}

/** A unit of measure — "ea", "hr", "ft". Quieter than the number it follows. */
export function UnitInput({
  className,
  size = "md",
  ...props
}: FieldProps) {
  return (
    <Input
      {...props}
      className={cn(
        CONTROL[size],
        "text-muted-foreground shrink-0 px-1 text-center",
        size === "sm" ? "w-12" : "w-14",
        className,
      )}
    />
  );
}

/* ── Small typographic pieces the editor repeats ──────────────────────── */

/** A section's name. Mono, tracked, small — the document's own labelling. */
export function SectionLabel({
  className,
  ...props
}: React.ComponentProps<"h3">) {
  return (
    <h3
      {...props}
      className={cn(
        "text-muted-foreground font-label text-[11px] uppercase",
        className,
      )}
    />
  );
}

/** A node's type, a cost bucket, an EST mark — all the same size and weight. */
export function Tag({
  className,
  interactive,
  ...props
}: React.ComponentProps<"span"> & { interactive?: boolean }) {
  return (
    <span
      {...props}
      className={cn(
        "text-muted-foreground border-border shrink-0 rounded border px-1.5 py-px font-label text-[10px] leading-4 whitespace-nowrap",
        interactive && "hover:text-foreground hover:border-ring transition-colors",
        className,
      )}
    />
  );
}
