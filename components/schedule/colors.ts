/**
 * A colour per person, the way a paper board gives each tech a colour of pen.
 *
 * **Tints, not fills.** Saturated blocks of eight colours on one week read as
 * noise and fight the brand's one accent; a light tint with a strong edge keeps
 * the text the same ink in both themes and lets the colour do only one job —
 * whose it is.
 *
 * Written out in full because Tailwind only ships classes it can find as
 * literal strings; a colour assembled at runtime would never be generated.
 */

export type Swatch = {
  /** The block's ground and its left edge. */
  block: string;
  /** A solid dot, for lists and the month view's timed chips. */
  dot: string;
  /** A checkbox in that person's colour, for the people list. */
  check: string;
};

const PALETTE: Swatch[] = [
  {
    block: "bg-sky-500/15 border-sky-500 hover:bg-sky-500/25",
    dot: "bg-sky-500",
    check: "border-sky-500 data-checked:border-sky-500 data-checked:bg-sky-500 dark:data-checked:bg-sky-500",
  },
  {
    block: "bg-emerald-500/15 border-emerald-500 hover:bg-emerald-500/25",
    dot: "bg-emerald-500",
    check: "border-emerald-500 data-checked:border-emerald-500 data-checked:bg-emerald-500 dark:data-checked:bg-emerald-500",
  },
  {
    block: "bg-violet-500/15 border-violet-500 hover:bg-violet-500/25",
    dot: "bg-violet-500",
    check: "border-violet-500 data-checked:border-violet-500 data-checked:bg-violet-500 dark:data-checked:bg-violet-500",
  },
  {
    block: "bg-rose-500/15 border-rose-500 hover:bg-rose-500/25",
    dot: "bg-rose-500",
    check: "border-rose-500 data-checked:border-rose-500 data-checked:bg-rose-500 dark:data-checked:bg-rose-500",
  },
  {
    block: "bg-amber-500/15 border-amber-500 hover:bg-amber-500/25",
    dot: "bg-amber-500",
    check: "border-amber-500 data-checked:border-amber-500 data-checked:bg-amber-500 dark:data-checked:bg-amber-500",
  },
  {
    block: "bg-teal-500/15 border-teal-500 hover:bg-teal-500/25",
    dot: "bg-teal-500",
    check: "border-teal-500 data-checked:border-teal-500 data-checked:bg-teal-500 dark:data-checked:bg-teal-500",
  },
  {
    block: "bg-orange-500/15 border-orange-500 hover:bg-orange-500/25",
    dot: "bg-orange-500",
    check: "border-orange-500 data-checked:border-orange-500 data-checked:bg-orange-500 dark:data-checked:bg-orange-500",
  },
  {
    block: "bg-indigo-500/15 border-indigo-500 hover:bg-indigo-500/25",
    dot: "bg-indigo-500",
    check: "border-indigo-500 data-checked:border-indigo-500 data-checked:bg-indigo-500 dark:data-checked:bg-indigo-500",
  },
];

/** Nobody on it yet — booked, but not staffed. Quiet, so it reads as a gap. */
export const UNASSIGNED: Swatch = {
  block: "bg-muted border-muted-foreground/50 hover:bg-muted/80",
  dot: "bg-muted-foreground/60",
  check:
    "border-muted-foreground data-checked:border-muted-foreground data-checked:bg-muted-foreground dark:data-checked:bg-muted-foreground",
};

/**
 * Each person's colour, by their place on the team. Stable across visits and
 * weeks, because the order of the team is.
 */
export function swatches(userIds: string[]): Map<string, Swatch> {
  return new Map(userIds.map((id, index) => [id, PALETTE[index % PALETTE.length]]));
}
