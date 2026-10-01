"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  saveTourProgress,
  useTours,
  type TourSession,
} from "@/components/tours/context";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  TOURS,
  findTour,
  onTourEvent,
  resumeAt,
  type TourDefinition,
  type TourId,
  type TourProgress,
  type TourStep,
} from "@/lib/tours";

/**
 * Draws whichever tour step is current, on whatever screen is showing.
 *
 * It decides three things, in order:
 *
 * 1. **Which tour** — one started by a button; else one asked for with
 *    `?tour=<id>`; else one whose route this is and that hasn't been finished
 *    or skipped.
 * 2. **Which step** — where the person left off, passing over optional steps
 *    whose part isn't on this screen.
 * 3. **Where** — the element carrying that step's `data-tour` marker. A
 *    required step whose marker isn't on screen simply waits.
 *
 * Nothing covers the page but the step's card and a ring on the part it's
 * about. No full-page mask: steps ask people to open pickers and sheets, and
 * those dialogs have to keep working while a step is up.
 */
export function TourHost() {
  const { progress, session, goTo, skip, complete } = useTours();
  const pathname = usePathname();
  const requested = useSearchParams().get("tour");

  const current = resolveCurrent(session, progress, pathname, requested);
  const tour = current ? TOURS[current.tourId] : null;

  const present = useSyncExternalStore(
    subscribeLayout,
    () => (tour ? presentOptionalAnchors(tour) : ""),
    () => ""
  );

  const visible = useMemo(() => {
    if (!tour) return [];
    const onScreen = new Set(present.split(","));
    return tour.steps.filter(
      (step) => !step.optional || onScreen.has(step.anchor)
    );
  }, [tour, present]);

  const index =
    tour && current ? visibleIndexFrom(tour, visible, current.stepId) : -1;
  const step = index >= 0 ? visible[index] : null;
  const next = index >= 0 ? (visible[index + 1] ?? null) : null;
  const previous = index > 0 ? visible[index - 1] : null;

  const target = useSyncExternalStore(
    subscribeLayout,
    () =>
      step ? document.querySelector<HTMLElement>(selector(step.anchor)) : null,
    () => null
  );
  const edges = useSyncExternalStore(
    subscribeLayout,
    () => (target ? edgesOf(positionOf(target)) : ""),
    () => ""
  );

  // A tour opened by its route or a link is recorded as it opens. One started
  // by a button is recorded by the provider as part of the click.
  const openedByItself =
    session.state === "idle" && current
      ? `${current.tourId}|${current.stepId}`
      : null;
  useEffect(() => {
    if (!openedByItself) return;
    const [tourId, stepId] = openedByItself.split("|");
    saveTourProgress(tourId as TourId, "in_progress", stepId);
  }, [openedByItself]);

  // An action step moves on when the screen reports the thing done.
  const tourId = tour?.id ?? null;
  const waitingFor =
    step?.advance.type === "action" ? step.advance.event : null;
  const nextId = next?.id ?? null;
  useEffect(() => {
    if (!tourId || !waitingFor) return;
    return onTourEvent((event) => {
      if (event !== waitingFor) return;
      if (nextId) goTo(tourId, nextId);
      else complete(tourId);
    });
  }, [tourId, waitingFor, nextId, goTo, complete]);

  // Ring the part the step is about.
  useEffect(() => {
    if (!target) return;
    target.setAttribute("data-tour-active", "");
    return () => target.removeAttribute("data-tour-active");
  }, [target]);

  // Bring it into view when the step changes — unless it already is.
  useEffect(() => {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (rect.top >= 80 && rect.bottom <= window.innerHeight - 16) return;

    const behavior: ScrollBehavior = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
      ? "auto"
      : "smooth";

    if (rect.height > window.innerHeight * 0.5) {
      // Taller than half the screen: show where it starts, under the pinned
      // bars, rather than centring a middle that says nothing.
      window.scrollBy({ top: rect.top - 96, behavior });
    } else {
      target.scrollIntoView({ behavior, block: "center" });
    }
  }, [target]);

  if (!tour || !step || !target || !edges) return null;

  const moveOn = () => (next ? goTo(tour.id, next.id) : complete(tour.id));

  return (
    <TourCard
      key={`${tour.id}:${step.id}`}
      anchor={positionOf(target)}
      side={chooseSide(parseEdges(edges))}
      step={step}
      position={index + 1}
      count={visible.length}
      last={next === null}
      onBack={previous ? () => goTo(tour.id, previous.id) : undefined}
      onNext={step.advance.type === "continue" ? moveOn : undefined}
      onSkipStep={step.advance.type === "action" ? moveOn : undefined}
      onSkipTour={() => skip(tour.id, step.id)}
    />
  );
}

function TourCard({
  anchor,
  side,
  step,
  position,
  count,
  last,
  onBack,
  onNext,
  onSkipStep,
  onSkipTour,
}: {
  anchor: HTMLElement;
  side: Side;
  step: TourStep;
  position: number;
  count: number;
  last: boolean;
  onBack?: () => void;
  onNext?: () => void;
  onSkipStep?: () => void;
  onSkipTour: () => void;
}) {
  // A virtual anchor: the element lives in the screen's tree, not this one.
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);

  return (
    <Popover open>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        side={side}
        align="start"
        sideOffset={14}
        collisionPadding={16}
        className="w-84 max-w-[calc(100vw-2rem)] gap-0 p-4 shadow-lg"
        // The page underneath stays usable — steps ride real work.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={onSkipTour}
      >
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-muted-foreground font-label text-[10px] uppercase tabular-nums">
            {position} of {count}
          </span>
          <button
            type="button"
            onClick={onSkipTour}
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
          >
            Skip tour
          </button>
        </div>

        <p className="mt-2 leading-snug font-semibold">{step.title}</p>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          {step.body}
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          {onBack ? (
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back
            </Button>
          ) : null}
          {onSkipStep ? (
            <Button variant="ghost" size="sm" onClick={onSkipStep}>
              Skip step
            </Button>
          ) : null}
          {onNext ? (
            <Button size="sm" onClick={onNext}>
              {last ? "Done" : "Next"}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ── Choosing ─────────────────────────────────────────────────────────── */

type Current = { tourId: TourId; stepId: string };

function resolveCurrent(
  session: TourSession,
  progress: Partial<Record<TourId, TourProgress>>,
  pathname: string,
  requested: string | null
): Current | null {
  if (session.state === "running") {
    return { tourId: session.tourId, stepId: session.stepId };
  }
  if (session.state === "closed") return null;

  const asked = requested ? findTour(requested) : null;
  if (asked) {
    return { tourId: asked.id, stepId: resumeAt(asked, progress[asked.id]) };
  }

  for (const tour of Object.values(TOURS)) {
    if (tour.trigger.type !== "route" || tour.trigger.pathname !== pathname) {
      continue;
    }
    const saved = progress[tour.id];
    if (!saved || saved.status === "in_progress") {
      return { tourId: tour.id, stepId: resumeAt(tour, saved) };
    }
  }

  return null;
}

/** The current step's place among the steps shown — or the next one that is. */
function visibleIndexFrom(
  tour: TourDefinition,
  visible: TourStep[],
  stepId: string
): number {
  const order = Math.max(
    0,
    tour.steps.findIndex((step) => step.id === stepId)
  );
  return visible.findIndex((step) => tour.steps.indexOf(step) >= order);
}

/* ── Reading the page ─────────────────────────────────────────────────── */

type Side = "top" | "right" | "bottom" | "left";
type Edges = { left: number; top: number; right: number; bottom: number };

const CARD_WIDTH = 336;
const CARD_HEIGHT = 230;

function selector(anchor: string) {
  return `[data-tour="${anchor}"]`;
}

/** Which optional steps have their part on screen, as a comparable string. */
function presentOptionalAnchors(tour: TourDefinition): string {
  return tour.steps
    .filter(
      (step) => step.optional && document.querySelector(selector(step.anchor))
    )
    .map((step) => step.anchor)
    .join(",");
}

/**
 * What the card is positioned against. A part taller than half the screen is
 * positioned by its heading, if it marks one with `data-tour-heading` — a card
 * placed below a whole long section would be off the screen.
 */
function positionOf(target: HTMLElement): HTMLElement {
  if (target.getBoundingClientRect().height <= window.innerHeight * 0.5) {
    return target;
  }
  return target.querySelector<HTMLElement>("[data-tour-heading]") ?? target;
}

function edgesOf(element: HTMLElement): string {
  const rect = element.getBoundingClientRect();
  return [rect.left, rect.top, rect.right, rect.bottom]
    .map((value) => Math.round(value))
    .join(",");
}

function parseEdges(edges: string): Edges {
  const [left, top, right, bottom] = edges.split(",").map(Number);
  return { left, top, right, bottom };
}

/** Below if it fits, then above, then beside. */
function chooseSide(anchor: Edges): Side {
  const room = {
    left: anchor.left,
    right: window.innerWidth - anchor.right,
    top: anchor.top,
    bottom: window.innerHeight - anchor.bottom,
  };
  const wide = CARD_WIDTH + 24;

  if (room.bottom > CARD_HEIGHT) return "bottom";
  if (room.top > CARD_HEIGHT) return "top";
  if (room.left > wide) return "left";
  if (room.right > wide) return "right";
  return "bottom";
}

/**
 * Re-reads on anything that can move or replace a marked part — scrolling,
 * resizing, the screen re-rendering — at most once a frame.
 */
function subscribeLayout(onChange: () => void) {
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    onChange();
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = requestAnimationFrame(flush);
    // Frames pause in hidden and throttled tabs. The timer keeps a step from
    // waiting on a frame that is not coming.
    timer = setTimeout(flush, 150);
  };

  const mutations = new MutationObserver(schedule);
  mutations.observe(document.body, { childList: true, subtree: true });
  const resizes = new ResizeObserver(schedule);
  resizes.observe(document.body);
  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule);

  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    mutations.disconnect();
    resizes.disconnect();
    window.removeEventListener("scroll", schedule, { capture: true });
    window.removeEventListener("resize", schedule);
  };
}
