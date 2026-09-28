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
 * Exported because Scope draws its own blocks — a narrative, a tree, an action
 * row — and they have to line up with the four sections that don't. Five cards
 * whose insides start at four slightly different places is most of what makes
 * an editor feel unfinished.
 */
export const SECTION_PAD = "px-4 @lg:px-5 @2xl:px-6";

/**
 * How far a nested Scope list steps in — the same distance as `SECTION_PAD`,
 * so a group's rail sits exactly under the left edge of the group's name.
 */
export const SECTION_INDENT = "ml-4 @lg:ml-5 @2xl:ml-6";

/**
 * A field's name inside a section, quieter than what is typed under it. The
 * value is what he is checking; the label only has to be findable.
 */
export const FIELD_LABEL = "text-muted-foreground text-[13px] font-medium";

/**
 * A document section as a card with a name, a number and what it holds.
 *
 * **All three, every time.** The sections used to carry an 11px grey label and
 * nothing else, and a first-time contractor read the page as one long form:
 * nothing said where Header ended and Scope began, what either held, or that
 * Pricing was not something to fill in. So:
 *
 * - **the number** makes the fixed order visible across both columns — 1 and 2
 *   in the document, 3 to 5 in the rail at the desk;
 * - **the line under the name** says what the section holds and whether it is
 *   his to write, which is the part nobody can guess;
 * - **the card** gives each section an edge, on a tinted ground, so five of
 *   them never run together.
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
  /**
   * Show the line explaining what the section is for. On by default; pass
   * false once the section has content in it, because by then the content
   * explains itself and the line is just grey furniture on every card.
   */
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
  hint,
  aside,
  labelId,
  tour,
  children,
  className,
  bodyClassName,
}: {
  label: string;
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
      className={cn("bg-background scroll-mt-20 rounded-xl border", className)}
    >
      <div className={cn("bg-muted/40 rounded-t-xl border-b py-3", SECTION_PAD)}>
        <CardHeading label={label} hint={hint} aside={aside} labelId={labelId} />
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
      hint={hint ? section.hint : null}
      aside={aside}
      labelId={`section-${id}-label`}
    />
  );
}

function CardHeading({
  label,
  hint,
  aside,
  labelId,
}: {
  label: string;
  hint?: string | null;
  aside?: ReactNode;
  labelId?: string;
}) {
  return (
    <div
      data-tour-heading
      className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"
    >
      {/* The aside drops to its own line rather than squeezing the hint into a
          one-word-per-line column, which is what it did at narrow widths. */}
      <div className="min-w-0 flex-1 basis-40">
        <h3
          id={labelId}
          className="text-foreground/80 font-label text-xs leading-5 uppercase"
        >
          {label}
        </h3>
        {hint ? (
          <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
            {hint}
          </p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0 text-xs leading-5">{aside}</div> : null}
    </div>
  );
}

/** The section's place in the fixed order — the same number wherever it sits. */
export function SectionNumber({ id }: { id: DocumentSectionId }) {
  const number = DOCUMENT_SECTIONS.findIndex((section) => section.id === id) + 1;

  return (
    <span
      aria-hidden
      className="bg-foreground text-background flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold tabular-nums"
    >
      {number}
    </span>
  );
}
