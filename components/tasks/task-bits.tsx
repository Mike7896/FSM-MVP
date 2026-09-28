"use client";

import { UserRound } from "lucide-react";

import type { Swatch } from "@/components/schedule/colors";
import { fromISODate, startOfDay } from "@/lib/schedule/dates";
import type { TeamMember } from "@/lib/schedule/types";
import { isClosed, type TaskPriority, type TaskStatus } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

/**
 * The small marks a task row is read by — drawn, not written, so a column of
 * them scans at a glance the way Linear's do.
 *
 * - **Status** fills as the task moves: a dashed ring (not planned), an empty
 *   ring (to do), half full (on it), full with a tick (done), grey with a
 *   cross (cancelled).
 * - **Priority** is signal bars, and urgent is the one mark in colour.
 */

export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const size = cn("size-3.5 shrink-0", className);
  switch (status) {
    case "backlog":
      return (
        <svg viewBox="0 0 14 14" className={cn(size, "text-muted-foreground")} aria-hidden>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 1.9" />
        </svg>
      );
    case "todo":
      return (
        <svg viewBox="0 0 14 14" className={cn(size, "text-muted-foreground")} aria-hidden>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "in_progress":
      return (
        <svg viewBox="0 0 14 14" className={cn(size, "text-amber-500")} aria-hidden>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 3.5 A3.5 3.5 0 0 1 7 10.5 Z" fill="currentColor" />
        </svg>
      );
    case "done":
      return (
        <svg viewBox="0 0 14 14" className={cn(size, "text-emerald-500")} aria-hidden>
          <circle cx="7" cy="7" r="6.25" fill="currentColor" />
          <path d="M4.4 7.2 6.2 9 9.7 5.3" fill="none" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "cancelled":
      return (
        <svg viewBox="0 0 14 14" className={cn(size, "text-muted-foreground")} aria-hidden>
          <circle cx="7" cy="7" r="6.25" fill="currentColor" />
          <path d="M5 5 9 9 M9 5 5 9" fill="none" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

export function PriorityIcon({ priority, className }: { priority: TaskPriority; className?: string }) {
  const size = cn("size-3.5 shrink-0", className);
  if (priority === "urgent") {
    return (
      <svg viewBox="0 0 14 14" className={cn(size, "text-orange-500")} aria-hidden>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
        <path d="M7 3.8v4" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10.1" r="0.95" fill="var(--background)" />
      </svg>
    );
  }
  if (priority === "none") {
    return (
      <svg viewBox="0 0 14 14" className={cn(size, "text-muted-foreground")} aria-hidden>
        <path d="M2 7h2M6 7h2M10 7h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  const lit = priority === "high" ? 3 : priority === "medium" ? 2 : 1;
  return (
    <svg viewBox="0 0 14 14" className={cn(size, "text-foreground")} aria-hidden>
      {[0, 1, 2].map((bar) => (
        <rect
          key={bar}
          x={1.5 + bar * 4}
          y={9 - bar * 3}
          width="3"
          height={4 + bar * 3}
          rx="0.8"
          fill="currentColor"
          opacity={bar < lit ? 1 : 0.25}
        />
      ))}
    </svg>
  );
}

/** Initials in the person's colour — the same colour they are on the schedule. */
export function PersonAvatar({
  member,
  swatch,
  className,
}: {
  member: TeamMember | null | undefined;
  swatch?: Swatch;
  className?: string;
}) {
  if (!member) {
    return (
      <span
        className={cn(
          "text-muted-foreground border-muted-foreground/60 flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed",
          className
        )}
        aria-label="Nobody"
      >
        <UserRound className="size-3" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white",
        swatch?.dot ?? "bg-muted-foreground",
        className
      )}
      title={member.name}
      aria-label={member.name}
    >
      {initials(member.name)}
    </span>
  );
}

function initials(name: string) {
  const words = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words.at(-1)![0] : "")).toUpperCase() || "?";
}

/** "Today", "Tomorrow", "Sep 28" — and whether it's late. */
export function dueOf(dueOn: string, status: TaskStatus) {
  const day = fromISODate(dueOn);
  const today = startOfDay(new Date());
  const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const label =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days === -1
          ? "Yesterday"
          : day.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              ...(day.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
            });
  const open = !isClosed(status);
  return {
    label,
    tone: open && days < 0 ? "late" : open && days === 0 ? "today" : "plain",
  } as const;
}

export function DueLabel({ dueOn, status, className }: { dueOn: string; status: TaskStatus; className?: string }) {
  const due = dueOf(dueOn, status);
  return (
    <span
      className={cn(
        "shrink-0 text-xs tabular-nums",
        due.tone === "late" ? "text-destructive" : due.tone === "today" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        className
      )}
      title={due.tone === "late" ? "Overdue" : undefined}
    >
      {due.label}
    </span>
  );
}
