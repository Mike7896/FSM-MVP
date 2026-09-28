"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { addMonths, sameDay, viewDays } from "@/lib/schedule/dates";
import { cn } from "@/lib/utils";

/**
 * The small month in the corner — for jumping, not for reading.
 *
 * It pages on its own without moving the big view, so a contractor can look
 * three weeks ahead for an open day and only go there when they pick one. The
 * days the big view is showing are shaded, so it's always clear where "here"
 * is.
 */
export function MiniMonth({
  selected,
  shown,
  onPick,
}: {
  /** The day the big view is anchored on. */
  selected: Date;
  /** The days the big view is showing, shaded here. */
  shown: Date[];
  onPick: (day: Date) => void;
}) {
  const [month, setMonth] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1)
  );
  const [followed, setFollowed] = useState(selected);

  // When the big view moves to another month, this follows it — but paging
  // here on its own doesn't move the big view.
  if (!sameDay(followed, selected)) {
    setFollowed(selected);
    if (
      selected.getMonth() !== month.getMonth() ||
      selected.getFullYear() !== month.getFullYear()
    ) {
      setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    }
  }

  const days = viewDays("month", month);
  const today = new Date();

  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between">
        <span className="pl-1 text-sm font-medium">
          {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Previous month"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Next month"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((letter, index) => (
          <span key={index} className="text-muted-foreground py-1 text-[10px] font-medium">
            {letter}
          </span>
        ))}
        {days.map((day) => {
          const inShown = shown.some((item) => sameDay(item, day));
          const isToday = sameDay(day, today);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onPick(day)}
              className={cn(
                "mx-auto my-px flex size-7 items-center justify-center rounded-full text-[11px] tabular-nums transition-colors",
                isToday
                  ? "bg-primary text-primary-foreground font-semibold"
                  : inShown
                    ? "bg-muted font-medium"
                    : day.getMonth() !== month.getMonth()
                      ? "text-muted-foreground hover:bg-muted"
                      : "hover:bg-muted"
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
