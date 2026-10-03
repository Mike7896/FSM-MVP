"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { formatQuantity, parseQuantity } from "@/lib/quote";
import { cn } from "@/lib/utils";

/** How long a press waits before it starts repeating, then how fast it goes. */
const HOLD_DELAY_MS = 400;
const REPEAT_START_MS = 120;
const REPEAT_FASTEST_MS = 35;

/** 2.5 + 1 is 3.5, not 3.4999999999999996. */
function tidy(value: number) {
  return Math.max(0, Math.round(value * 1000) / 1000);
}

/**
 * A quantity with up and down arrows: a click steps by one, holding keeps
 * stepping and speeds up the longer it's held. Typing still works, and the
 * arrow keys step too — Shift steps by ten.
 */
export function QuantityStepper({
  value,
  onChange,
  label = "Quantity",
}: {
  value: number;
  onChange: (quantity: number) => void;
  label?: string;
}) {
  // Held as text while typing, so a half-typed "1." isn't reformatted under
  // the cursor.
  const [text, setText] = useState<string | null>(null);

  // The value a held arrow is counting from. The parent's copy can lag a
  // render behind a fast repeat, so the count keeps its own.
  const current = useRef(value);
  const timer = useRef<number | null>(null);
  const holding = useRef(false);

  useEffect(() => {
    if (!holding.current) current.current = value;
  }, [value]);

  useEffect(() => stop, []);

  function step(delta: number) {
    current.current = tidy(current.current + delta);
    setText(null);
    onChange(current.current);
  }

  function stop() {
    holding.current = false;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }

  function start(event: PointerEvent<HTMLButtonElement>, delta: number) {
    if (event.button !== 0) return;
    // Keep the cursor where it was; the arrows aren't somewhere to type.
    event.preventDefault();
    stop();
    holding.current = true;
    current.current = value;
    step(delta);

    let interval = REPEAT_START_MS;
    const repeat = () => {
      step(delta);
      interval = Math.max(REPEAT_FASTEST_MS, interval * 0.88);
      timer.current = window.setTimeout(repeat, interval);
    };
    timer.current = window.setTimeout(repeat, HOLD_DELAY_MS);
  }

  return (
    <div className="border-input bg-background focus-within:border-ring focus-within:ring-ring/30 flex h-[31px] w-20 shrink-0 items-stretch overflow-hidden rounded-md border transition-colors focus-within:ring-3 hover:border-muted-foreground">
      <input
        inputMode="decimal"
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent px-1.5 text-center text-xs tabular-nums outline-none"
        value={text ?? formatQuantity(value)}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = parseQuantity(event.target.value);
          if (parsed !== null) {
            current.current = parsed;
            onChange(parsed);
          }
        }}
        onBlur={() => setText(null)}
        onKeyDown={(event) => {
          if (event.altKey || event.metaKey || event.ctrlKey) return;
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          current.current = value;
          const size = event.shiftKey ? 10 : 1;
          step(event.key === "ArrowUp" ? size : -size);
        }}
      />
      <div className="border-input flex w-5 shrink-0 flex-col border-l">
        <StepButton
          label={`More (${label.toLowerCase()})`}
          onPointerDown={(event) => start(event, 1)}
          onStop={stop}
        >
          <ChevronUp className="size-3" />
        </StepButton>
        <StepButton
          label={`Less (${label.toLowerCase()})`}
          disabled={value <= 0}
          onPointerDown={(event) => start(event, -1)}
          onStop={stop}
          className="border-input border-t"
        >
          <ChevronDown className="size-3" />
        </StepButton>
      </div>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onPointerDown,
  onStop,
  className,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onStop: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // The arrow keys in the field do this from the keyboard.
      tabIndex={-1}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerUp={onStop}
      onPointerLeave={onStop}
      onPointerCancel={onStop}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80 flex flex-1 items-center justify-center transition-colors select-none touch-none disabled:pointer-events-none disabled:opacity-30",
        className
      )}
    >
      {children}
    </button>
  );
}
