/**
 * The trade-pack catalogue — **content, not rows.**
 *
 * A pack is what the app is equipped for: templates, field definitions, scope
 * language, option lists and pricing rules for one trade. None of that is
 * tenant data, so none of it belongs in the database. `pack_entitlements` and
 * `pack_enablement` are the tenant's half — what this shop has paid for and
 * what it is running — and they key on the `id` values here.
 *
 * Two consequences worth stating, because they are why this is a module:
 *
 * - **A pack ships with a release, not a migration.** Adding a trade is a pull
 *   request that a reviewer can read, and it goes out with the code that knows
 *   how to render it.
 * - **A quote remembers the pack it was written under.** `quotes.pack_id` holds
 *   one of these ids forever, so an id is a permanent identifier: rename the
 *   label freely, never the id, or a year-old electrical quote stops knowing
 *   what it was.
 *
 * **Sell counted contents, never adjectives.** The whole anxiety a pack has to
 * answer is *is this real, or an upsell?* — and specificity is the only thing
 * that answers it. "Wire by gauge and footage, permit handling" is a product;
 * "supercharge your electrical workflow" is not.
 *
 * **A count is only written here once the thing counted exists.** The rows once
 * carried numbers — 24 job types, 11 quote templates — for content no part of
 * this codebase contains, which is the same invented specificity the product
 * refuses everywhere else. Counts come back with the templates they count, and
 * a pack stays `coming` until there is something behind it to turn on.
 *
 * **Prices are not here.** What a pack costs is a Stripe Price, looked up by
 * the `stripePriceLookupKey` below, because the money has to come from the
 * system that will actually charge for it. A pack with no matching Stripe price
 * is shown without one rather than with a number we made up.
 */

export type PackStatus =
  /** Buyable today. */
  | "available"
  /** Built, not yet released. Shown so the roadmap is visible, never sold. */
  | "coming";

export type PackContent = {
  /**
   * A count, once the content it counts is actually built. `null` until then,
   * and `null` for a named capability that was never a number.
   */
  count: number | null;
  title: string;
  detail: string;
};

export type Pack = {
  /** Permanent. `quotes.pack_id` and the entitlement tables store this. */
  id: string;
  name: string;
  /** One line, in the trade's own words. */
  summary: string;
  status: PackStatus;
  /**
   * The Stripe Price this pack bills through. Resolved against the `prices`
   * read-model at render time; absent from that table means the pack is not
   * sellable yet, and the surface says so rather than inventing a figure.
   */
  stripePriceLookupKey: string | null;
  contents: PackContent[];
};

export const PACKS: Pack[] = [
  {
    id: "electrical",
    name: "Electrical",
    summary:
      "Service and panel work, circuits, fixtures and EV, with the permit and inspection cycle built in.",
    // `coming` until the templates and job types below exist: nothing in the
    // app reads a pack yet, so an `available` electrical pack would be sold on
    // contents that are not there.
    status: "coming",
    stripePriceLookupKey: "pack_electrical",
    contents: [
      {
        count: null,
        title: "Job types for the work you actually take",
        detail:
          "panel swap, service change, rewire, EV charger, generator interlock, recessed lighting…",
      },
      {
        count: null,
        title: "Quote templates in the trade's own words",
        detail:
          "scope, exclusions and assumptions already written, and every word yours to change",
      },
      {
        count: null,
        title: "Wire and device by gauge, run and count",
        detail: "12/2 by the foot, cans by the fixture, breakers by the slot",
      },
      {
        count: null,
        title: "Permit and inspection handling",
        detail:
          "rough-in, service and final as named lines, never a note in the scope",
      },
      {
        count: null,
        title: "Code-aware scope language",
        detail: "you can edit — every word is yours to change",
      },
    ],
  },
  {
    id: "plumbing",
    name: "Plumbing",
    summary:
      "Water heaters, repipes, sewer and fixture work, priced by the fixture and the run.",
    status: "coming",
    stripePriceLookupKey: null,
    contents: [
      {
        count: null,
        title: "Job types for the work you actually take",
        detail:
          "water heater swap, repipe, sewer line, fixture set, backflow test, slab leak…",
      },
      {
        count: null,
        title: "Quote templates in the trade's own words",
        detail:
          "scope, exclusions and assumptions already written, and every word yours to change",
      },
      {
        count: null,
        title: "Line items by material and size",
        detail: "priced by the foot, the fixture, or the run",
      },
      {
        count: null,
        title: "Permit and inspection handling",
        detail: "as named lines, not a note in the scope",
      },
    ],
  },
  {
    id: "hvac",
    name: "HVAC",
    summary:
      "Changeouts, ductwork and maintenance plans, with the tiering that trade actually sells in.",
    status: "coming",
    stripePriceLookupKey: null,
    contents: [
      {
        count: null,
        title: "Job types for the work you actually take",
        detail:
          "condenser and coil changeout, furnace swap, mini-split, duct replacement, seasonal service…",
      },
      {
        count: null,
        title: "Good / better / best tiering",
        detail:
          "the option structure this trade sells in, over one set of line items",
      },
      {
        count: null,
        title: "Equipment by tonnage and efficiency",
        detail: "with the rebate paperwork named as its own line",
      },
    ],
  },
];

export function findPack(id: string): Pack | null {
  return PACKS.find((pack) => pack.id === id) ?? null;
}

/**
 * What a pack is, in one line, for a surface that has only the id.
 *
 * Falls back to the id itself rather than throwing: a quote written under a
 * pack that was later removed from the catalogue must still open, because the
 * document is a record of what was sent and pack state must never rewrite
 * history.
 */
export function packName(id: string | null): string {
  if (!id) return "No trade pack";
  return findPack(id)?.name ?? id;
}
