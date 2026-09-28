"use client";

import { useCallback, useRef, useState } from "react";
import { Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE PAD — where a signature is actually made.
 *
 * **SVG, not canvas.** The strokes are captured directly as path data in a
 * fixed 600×200 space, which means what is rendered *is* what is stored: no
 * rasterizing step, no 40 KB base64 PNG, no soft edges when a court exhibit is
 * printed at 300 dpi, and nothing to re-derive when the same signature has to
 * appear on a PDF later.
 *
 * Three things it has to get right, and each one is where a hand-rolled
 * signature pad usually fails:
 *
 * - **Touch is the primary input.** A homeowner signs with a finger on a phone
 *   in her kitchen. `touch-action: none` is what stops the browser scrolling
 *   the page instead of drawing, and pointer capture is what stops the stroke
 *   dying when her finger leaves the box mid-letter.
 * - **The coordinate space is fixed.** Points are mapped into 600×200 on the
 *   way in, so a signature drawn on a 320 px phone renders identically beside
 *   one drawn on a desktop, and neither depends on the size of the element it
 *   was made in.
 * - **Strokes are smoothed.** Raw pointer samples are polygons, and a signature
 *   drawn as straight segments looks like a seismograph. Quadratic curves
 *   through the midpoints cost nothing and are the difference between a
 *   signature and a scribble.
 */

const VIEW = { width: 600, height: 200 };

/** Sub-pixel noise in the path data is bytes with no information in it. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Points to an SVG path, smoothed.
 *
 * Each segment is a quadratic curve whose control point is the sample and whose
 * end point is the midpoint to the next sample — the standard trick, and the
 * reason it works is that consecutive midpoints are always on the curve, so the
 * strokes join without corners.
 */
function toPath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    // A tap is a dot — a period in an initial, or a deliberate mark.
    const { x, y } = points[0];
    return `M ${round(x)} ${round(y)} l 0.1 0`;
  }

  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    const next = points[i + 1];
    d += ` Q ${round(point.x)} ${round(point.y)} ${round((point.x + next.x) / 2)} ${round((point.y + next.y) / 2)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${round(last.x)} ${round(last.y)}`;
  return d;
}

export type SignaturePadHandle = {
  paths: string[];
  clear: () => void;
};

export function SignaturePad({
  onChange,
  disabled,
  className,
}: {
  /** Fires on every completed stroke, and on clear. */
  onChange: (paths: string[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const surface = useRef<SVGSVGElement | null>(null);
  const drawing = useRef<{ x: number; y: number }[]>([]);

  const [paths, setPaths] = useState<string[]>([]);
  const [live, setLive] = useState<string>("");

  const pointAt = useCallback((event: React.PointerEvent) => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };

    // Into the fixed space, so the stored stroke does not depend on how wide
    // the element happened to be on this device.
    return {
      x: ((event.clientX - box.left) / box.width) * VIEW.width,
      y: ((event.clientY - box.top) / box.height) * VIEW.height,
    };
  }, []);

  function start(event: React.PointerEvent) {
    if (disabled) return;
    // Capture, so a stroke that wanders outside the box keeps drawing instead
    // of breaking in the middle of a letter.
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = [pointAt(event)];
    setLive(toPath(drawing.current));
  }

  function move(event: React.PointerEvent) {
    if (disabled || drawing.current.length === 0) return;
    drawing.current.push(pointAt(event));
    setLive(toPath(drawing.current));
  }

  function end() {
    if (drawing.current.length === 0) return;

    const path = toPath(drawing.current);
    drawing.current = [];
    setLive("");

    const next = [...paths, path];
    setPaths(next);
    onChange(next);
  }

  function undo() {
    const next = paths.slice(0, -1);
    setPaths(next);
    onChange(next);
  }

  function clear() {
    drawing.current = [];
    setLive("");
    setPaths([]);
    onChange([]);
  }

  const empty = paths.length === 0 && live === "";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative">
        <svg
          ref={surface}
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          className={cn(
            "bg-background w-full rounded-lg border",
            // Without this the browser scrolls the page instead of drawing the
            // moment a finger moves. It is the single most important line here.
            "touch-none",
            disabled ? "opacity-60" : "cursor-crosshair"
          )}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          role="img"
          aria-label="Signature pad. Draw your signature here."
        >
          {/* The line they sign on, the way a paper form has one. */}
          <line
            x1="40"
            y1="150"
            x2={VIEW.width - 40}
            y2="150"
            stroke="currentColor"
            strokeWidth="1"
            className="text-muted-foreground/30"
          />
          {[...paths, live].filter(Boolean).map((d, index) => (
            <path
              key={index}
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>

        {empty ? (
          <p className="text-muted-foreground pointer-events-none absolute inset-x-0 bottom-6 text-center text-xs">
            Sign above
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={undo}
          disabled={disabled || paths.length === 0}
        >
          <Undo2 className="size-3.5" />
          Undo
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={disabled || empty}
        >
          <X className="size-3.5" />
          Clear
        </Button>
      </div>
    </div>
  );
}
