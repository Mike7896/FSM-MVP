"use client";

import { createContext, useContext, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * One overlay, two shapes: a **bottom sheet on a phone, a centred dialog at the
 * desk.**
 *
 * A sheet that slides up from the bottom edge of a 1440px monitor is a phone
 * interaction wearing a desktop screen — it puts the content a mile from the
 * pointer, wastes the middle of the display, and reads as though the site was
 * built for a phone and stretched.
 *
 * **Viewport, not container.** Everywhere else in the editor the layout asks how
 * wide its own container is, because the same component is mounted in a wide
 * page and a narrow column at once. An overlay is different in kind: it is
 * portaled to `body` and positioned against the window, so how big the *window*
 * is genuinely is the question. Hence `useIsMobile` here and container queries
 * there — the inconsistency is the point.
 *
 * Both branches are given `p-0`, so a caller writes one set of padding and gets
 * the same spacing in either shape. The primitives disagree about this by
 * default — `SheetContent` is a flex column with no padding, `DialogContent` is
 * a grid with `p-4` — and normalising it here is what stops every call site
 * growing two sets of classes.
 */

const Shape = createContext(false);

export function ResponsiveDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const Root = isMobile ? Sheet : Dialog;

  return (
    <Shape.Provider value={isMobile}>
      <Root open={open} onOpenChange={onOpenChange}>
        {children}
      </Root>
    </Shape.Provider>
  );
}

export function ResponsiveDialogContent({
  className,
  desktopClassName,
  children,
  ...props
}: {
  /** Applied in both shapes. */
  className?: string;
  /** Desktop only — width lives here, since a bottom sheet is edge-to-edge. */
  desktopClassName?: string;
  children: ReactNode;
} & React.ComponentProps<typeof DialogContent>) {
  const isMobile = useContext(Shape);

  if (isMobile) {
    return (
      <SheetContent
        side="bottom"
        className={cn(
          "flex max-h-[92vh] flex-col gap-0 overflow-y-auto p-0",
          className
        )}
        {...props}
      >
        {children}
      </SheetContent>
    );
  }

  return (
    <DialogContent
      className={cn(
        "flex max-h-[85vh] flex-col gap-0 overflow-y-auto p-0",
        // The primitive defaults to `sm:max-w-sm`, which is narrower than any
        // of these overlays wants.
        "sm:max-w-lg",
        className,
        desktopClassName
      )}
      {...props}
    >
      {children}
    </DialogContent>
  );
}

/**
 * The title block. Uses the primitive's own Title so Radix's labelling
 * requirement is satisfied in both shapes — a dialog without one warns, and
 * screen readers get nothing to announce.
 */
export function ResponsiveDialogHeader({
  title,
  description,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  const isMobile = useContext(Shape);
  const Title = isMobile ? SheetTitle : DialogTitle;
  const Description = isMobile ? SheetDescription : DialogDescription;

  return (
    <div
      className={cn(
        "bg-background sticky top-0 z-10 shrink-0 border-b px-4 py-3",
        className
      )}
    >
      <Title className="text-base font-semibold">{title}</Title>
      {description ? (
        <Description className="mt-1 text-sm">{description}</Description>
      ) : null}
    </div>
  );
}

/** Scrolls; everything the overlay is actually for goes in here. */
export function ResponsiveDialogBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("flex-1 p-4", className)}>{children}</div>;
}

/**
 * Pinned to the bottom of the overlay in both shapes, because the primary
 * action must never sit below a long document — at desk height these overlays
 * are taller than the space they are given.
 */
export function ResponsiveDialogFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-background sticky bottom-0 z-10 shrink-0 border-t px-4 py-3",
        className
      )}
    >
      {children}
    </div>
  );
}
