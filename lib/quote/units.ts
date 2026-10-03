import type { LineSection } from "./types";

/**
 * Units of measure for a priced row — the list the unit picker offers.
 *
 * Stored as the short form on the row (`hr`, `sq ft`), which is what prints on
 * the quote. Anything else a contractor types is kept exactly as typed: the
 * list is a shortcut, never a limit.
 */

export type UnitOption = {
  /** What's stored and printed. */
  value: string;
  /** What it means, for the picker. */
  name: string;
};

export type UnitGroup = { label: string; units: UnitOption[] };

export const UNIT_GROUPS: UnitGroup[] = [
  {
    label: "Count",
    units: [
      { value: "ea", name: "each" },
      { value: "pr", name: "pair" },
      { value: "set", name: "set" },
      { value: "lot", name: "lot" },
      { value: "job", name: "whole job" },
    ],
  },
  {
    label: "Time",
    units: [
      { value: "hr", name: "hour" },
      { value: "day", name: "day" },
      { value: "wk", name: "week" },
      { value: "mo", name: "month" },
    ],
  },
  {
    label: "Length",
    units: [
      { value: "ft", name: "foot" },
      { value: "lf", name: "linear foot" },
      { value: "yd", name: "yard" },
    ],
  },
  {
    label: "Area",
    units: [
      { value: "sq ft", name: "square foot" },
      { value: "sq yd", name: "square yard" },
      { value: "sq", name: "roofing square (100 sq ft)" },
    ],
  },
  {
    label: "Volume",
    units: [
      { value: "gal", name: "gallon" },
      { value: "qt", name: "quart" },
      { value: "cu yd", name: "cubic yard" },
    ],
  },
  {
    label: "Weight",
    units: [
      { value: "lb", name: "pound" },
      { value: "ton", name: "ton" },
    ],
  },
  {
    label: "Packaged",
    units: [
      { value: "box", name: "box" },
      { value: "bag", name: "bag" },
      { value: "roll", name: "roll" },
      { value: "sheet", name: "sheet" },
      { value: "pail", name: "pail / bucket" },
      { value: "case", name: "case" },
    ],
  },
];

const ALL_UNITS = UNIT_GROUPS.flatMap((group) => group.units);

/** The units a row in each cost category usually carries, most likely first. */
export const UNITS_FOR_BUCKET: Record<LineSection, string[]> = {
  material: ["ea", "gal", "sq ft", "lf", "box", "bag", "roll", "sheet"],
  labor: ["hr", "day", "job", "ea"],
  equipment: ["day", "wk", "hr", "ea"],
  permit: ["ea", "job"],
};

/**
 * The preset a stored value means, if any — "Gal" is gallons and "Hour" is
 * hours, whichever way he typed them.
 */
export function unitOption(value: string): UnitOption | null {
  const typed = value.trim().toLowerCase();
  return (
    ALL_UNITS.find(
      (unit) => unit.value === typed || unit.name.toLowerCase() === typed
    ) ?? null
  );
}

/** Whether a unit is one the contractor made up rather than one from the list. */
export function isCustomUnit(value: string): boolean {
  return unitOption(value) === null;
}
