/**
 * Tours — the shapes every tour is written in.
 *
 * **A tour is data.** Each one is a plain definition in this directory, listed
 * in the registry, and nothing about it lives in the screens it walks through.
 * A screen carries two things only: `data-tour` markers on the parts a step can
 * point at, and `emitTourEvent` calls at the moments a step can wait for. It
 * never learns which tour, if any, is listening — which is what lets one system
 * run every tour in the app, and a later Learn section list them all.
 *
 * No React and no DOM here, so the server reads the registry too: to validate a
 * progress write, and to decide what the dashboard offers to resume.
 */

/** Every tour there is. A new tour is a registry entry, not a new system. */
export type TourId = "onboarding";

/**
 * The moments a step can wait for. Closed on purpose: a screen emits one of
 * these, and a typo on either side is a compile error rather than a step that
 * silently never moves on.
 */
export type TourEvent =
  | "quote.priced-row-added"
  | "quote.price-entered"
  | "quote.previewed";

export type TourStatus = "in_progress" | "completed" | "skipped";

/** How a step moves on. */
export type TourAdvance =
  /** It explains something. The person reads it and presses Next. */
  | { type: "continue" }
  /** It asks for something, and moves on when the screen reports it done. */
  | { type: "action"; event: TourEvent };

export type TourStep = {
  id: string;
  /** The `data-tour` marker this step points at. */
  anchor: string;
  title: string;
  body: string;
  advance: TourAdvance;
  /**
   * Passed over, rather than waited for, when its marker isn't on screen — for
   * parts that only exist at some widths, like the desk-only margin panel.
   */
  optional?: boolean;
};

/** What opens a tour without anyone asking for it. */
export type TourTrigger =
  /**
   * Landing on this path, unless the tour was finished or skipped. A tour left
   * in progress picks up where it stopped.
   */
  | { type: "route"; pathname: string }
  /** Only a button (`start`, `resume`) or a `?tour=<id>` link. */
  | { type: "manual" };

export type TourDefinition = {
  id: TourId;
  /** For anything that lists tours — "Resume tour" now, Learn later. */
  title: string;
  summary: string;
  trigger: TourTrigger;
  /** Where to send someone to take the tour on purpose. */
  href: string;
  steps: TourStep[];
};

export type TourProgress = {
  tourId: TourId;
  status: TourStatus;
  /** The step to resume at. Null once there is nothing left to resume. */
  stepId: string | null;
  updatedAt: string;
};
