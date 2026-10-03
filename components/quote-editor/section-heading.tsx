"use client";

import type { ReactNode } from "react";

import {
  DOCUMENT_SECTIONS,
  documentSection,
  type DocumentSectionId,
} from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * The one horizontal padding every section is set in.
 *
 * Exported because Scope draws its own blocks — a paragraph, the rows, an
 * action row — and they have to line up with the sections that don't.
 */
export const SECTION_PAD = "px-4 @lg:px-5 @2xl:px-6";

/**
 * How far a nested Scope list steps in — the same distance as `SECTION_PAD`,
 * so a group's rail sits exactly under the left edge of the group's name.
 */
export const SECTION_INDENT = "ml-4 @lg:ml-5 @2xl:ml-6";

/*
 * The editor's type scale, largest to smallest:
 *
 *   section title    16px semibold      "Header", "Scope"
 *   group eyebrow    12px caps, muted   "For", "From"
 *   field label      14px medium        "Customer", "Scope of work"
 *   field value      14–15px            what's typed
 *   help             13px, muted        one line under a label, where needed
 */

/** A field's name. The same size for every field, whatever its input looks like. */
export const FIELD_LABEL = "text-foreground text-sm font-medium";

/** One line under a field's label, for what the label can't say. */
export const FIELD_HELP = "text-muted-foreground text-[13px] leading-snug";

/** A small heading over a few fields that belong together. */
export const EYEBROW =
  "text-muted-foreground text-xs font-semibold tracking-wide uppercase";

/**
 * A document section as a card: its number, its name, and — while it's empty
 * and the name doesn't say enough — one line on what goes in it.
 *
 * `data-tour` on the card is the tour's contract with the editor, and
 * `data-tour-heading` is what its card anchors to — a section can be taller
 * than the screen, and a card pinned to the bottom of one would be off it.
 */
export function SectionCard({
  id,
  aside,
  hint,
  label,
  hintText,
  children,
  className,
  bodyClassName,
}: {
  id: DocumentSectionId;
  /** Something about the whole section — a count, a Change link. */
  aside?: ReactNode;
  /** Show the line under the name. Pass false once the section has content. */
  hint?: boolean;
  /**
   * The section's name and line, where the document is not a quote. A change
   * order's Scope holds the change, not the whole job, and says so.
   */
  label?: string;
  hintText?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const section = documentSection(id);

  return (
    <EditorCard
      tour={`quote.${id}`}
      labelId={`section-${id}-label`}
      label={label ?? section.label}
      number={DOCUMENT_SECTIONS.findIndex((entry) => entry.id === id) + 1}
      hint={hint === false ? null : (hintText ?? section.hint)}
      aside={aside}
      className={className}
      bodyClassName={bodyClassName}
    >
      {children}
    </EditorCard>
  );
}

/**
 * The card every panel in the editor is set in — a document section, or a
 * panel that isn't one (a change order's schedule and billing). One shape, so
 * the two never read as two different products on one screen.
 */
export function EditorCard({
  label,
  number,
  hint,
  aside,
  labelId,
  tour,
  children,
  className,
  bodyClassName,
}: {
  label: string;
  /** The section's place in the document's fixed order. */
  number?: number;
  hint?: string | null;
  aside?: ReactNode;
  labelId?: string;
  tour?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      data-tour={tour}
      aria-labelledby={labelId}
      aria-label={labelId ? undefined : label}
      className={cn("bg-card scroll-mt-20 rounded-xl border", className)}
    >
      <div className={cn("border-b py-3.5", SECTION_PAD)}>
        <CardHeading
          label={label}
          number={number}
          hint={hint}
          aside={aside}
          labelId={labelId}
        />
      </div>
      <div className={cn(SECTION_PAD, "py-4 @lg:py-5 @2xl:py-6", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

export function SectionHeading({
  id,
  aside,
  hint = true,
}: {
  id: DocumentSectionId;
  aside?: ReactNode;
  hint?: boolean;
}) {
  const section = documentSection(id);

  return (
    <CardHeading
      label={section.label}
      number={DOCUMENT_SECTIONS.findIndex((entry) => entry.id === id) + 1}
      hint={hint ? section.hint : null}
      aside={aside}
      labelId={`section-${id}-label`}
    />
  );
}

function CardHeading({
  label,
  number,
  hint,
  aside,
  labelId,
}: {
  label: string;
  number?: number;
  hint?: string | null;
  aside?: ReactNode;
  labelId?: string;
}) {
  return (
    <div
      data-tour-heading
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
    >
      {/* The aside drops to its own line rather than squeezing the hint into a
          one-word-per-line column, which is what it did at narrow widths. */}
      <div className="flex min-w-0 flex-1 basis-28 items-start gap-2.5">
        {number ? <NumberBadge number={number} /> : null}
        <div className="min-w-0">
          <h3
            id={labelId}
            className="text-foreground text-base leading-6 font-semibold tracking-tight"
          >
            {label}
          </h3>
          {hint ? (
            <p className="text-muted-foreground text-[13px] leading-snug">
              {hint}
            </p>
          ) : null}
        </div>
      </div>
      {aside ? <div className="shrink-0 text-sm">{aside}</div> : null}
    </div>
  );
}

function NumberBadge({ number }: { number: number }) {
  return (
    <span
      aria-hidden
      className="bg-foreground text-background mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums"
    >
      {number}
    </span>
  );
}

/** The section's place in the fixed order — the same number wherever it sits. */
export function SectionNumber({ id }: { id: DocumentSectionId }) {
  return (
    <NumberBadge
      number={DOCUMENT_SECTIONS.findIndex((section) => section.id === id) + 1}
    />
  );
}
