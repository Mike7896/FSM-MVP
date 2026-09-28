"use client";

import { useState, type ReactNode, type SyntheticEvent } from "react";
import { CalendarDays, Check, X } from "lucide-react";

import type { Swatch } from "@/components/schedule/colors";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addDays, startOfDay, toISODate } from "@/lib/schedule/dates";
import type { TeamMember } from "@/lib/schedule/types";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  priorityLabel,
  statusLabel,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

import { DueLabel, PersonAvatar, PriorityIcon, StatusIcon } from "./task-bits";

/**
 * The four things changed on a task without opening it — where it's got to,
 * how much it matters, whose it is, when it's due. Each is a mark on the row
 * that is also the menu for changing it, the way Linear does it: click the
 * circle, pick Done.
 *
 * A menu inside a row or a card keeps its clicks to itself, so opening one
 * never also opens the task or starts a drag.
 */

const keep = (event: SyntheticEvent) => event.stopPropagation();

function MarkButton({
  label,
  children,
  className,
  ...props
}: { label: string; children: ReactNode; className?: string } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={keep}
      onClick={keep}
      onKeyDown={keep}
      className={cn(
        "hover:bg-muted focus-visible:ring-ring/50 inline-flex shrink-0 items-center gap-1.5 rounded-md p-1 outline-none focus-visible:ring-2",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function StatusMenu({
  status,
  onChange,
  withLabel = false,
  className,
}: {
  status: TaskStatus;
  onChange: (status: TaskStatus) => void;
  withLabel?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MarkButton label={`Status: ${statusLabel(status)}`} className={className}>
          <StatusIcon status={status} />
          {withLabel ? <span className="text-sm">{statusLabel(status)}</span> : null}
        </MarkButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44" onClick={keep}>
        {TASK_STATUSES.map((entry) => (
          <DropdownMenuItem key={entry.status} onSelect={() => onChange(entry.status)}>
            <StatusIcon status={entry.status} />
            {entry.label}
            {entry.status === status ? <Check className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PriorityMenu({
  priority,
  onChange,
  withLabel = false,
  className,
}: {
  priority: TaskPriority;
  onChange: (priority: TaskPriority) => void;
  withLabel?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MarkButton label={`Priority: ${priorityLabel(priority)}`} className={className}>
          <PriorityIcon priority={priority} />
          {withLabel ? <span className="text-sm">{priorityLabel(priority)}</span> : null}
        </MarkButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44" onClick={keep}>
        {TASK_PRIORITIES.map((entry) => (
          <DropdownMenuItem key={entry.priority} onSelect={() => onChange(entry.priority)}>
            <PriorityIcon priority={entry.priority} />
            {entry.label}
            {entry.priority === priority ? <Check className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AssigneeMenu({
  assigneeId,
  team,
  colorOf,
  me,
  onChange,
  withLabel = false,
  className,
}: {
  assigneeId: string | null;
  team: TeamMember[];
  colorOf: (userId: string) => Swatch;
  me: string;
  onChange: (userId: string | null) => void;
  withLabel?: boolean;
  className?: string;
}) {
  const member = team.find((person) => person.userId === assigneeId) ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MarkButton label={member ? `Whose: ${member.name}` : "Whose: nobody yet"} className={className}>
          <PersonAvatar member={member} swatch={member ? colorOf(member.userId) : undefined} />
          {withLabel ? (
            <span className={cn("truncate text-sm", !member && "text-muted-foreground")}>
              {member ? member.name : "Nobody yet"}
            </span>
          ) : null}
        </MarkButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56" onClick={keep}>
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Whose is it</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <PersonAvatar member={null} />
          Nobody yet
          {assigneeId === null ? <Check className="ml-auto size-4" /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {team.map((person) => (
          <DropdownMenuItem key={person.userId} onSelect={() => onChange(person.userId)}>
            <PersonAvatar member={person} swatch={colorOf(person.userId)} />
            <span className="truncate">
              {person.name}
              {person.userId === me ? <span className="text-muted-foreground"> (you)</span> : null}
            </span>
            {person.userId === assigneeId ? <Check className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** When it's due: the usual few one tap away, any day by the date field. */
export function DueMenu({
  dueOn,
  status,
  onChange,
  withLabel = false,
  className,
}: {
  dueOn: string | null;
  status: TaskStatus;
  onChange: (dueOn: string | null) => void;
  withLabel?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = startOfDay(new Date());
  // The coming Monday — never today, even on a Monday.
  const monday = addDays(today, ((8 - today.getDay()) % 7) || 7);
  const quick: [string, Date][] = [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["Next Monday", monday],
    ["In a week", addDays(today, 7)],
  ];
  const pick = (value: string | null) => {
    onChange(value);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <MarkButton label={dueOn ? "Change the due date" : "Set a due date"} className={className}>
          {dueOn ? (
            <>
              {withLabel ? <CalendarDays className="text-muted-foreground size-3.5" /> : null}
              <DueLabel dueOn={dueOn} status={status} className={withLabel ? "text-sm" : undefined} />
            </>
          ) : (
            <>
              <CalendarDays className="text-muted-foreground size-3.5" />
              {withLabel ? <span className="text-muted-foreground text-sm">No due date</span> : null}
            </>
          )}
        </MarkButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2" onClick={keep}>
        <div className="grid grid-cols-2 gap-1">
          {quick.map(([label, day]) => (
            <Button
              key={label}
              type="button"
              variant={dueOn === toISODate(day) ? "secondary" : "ghost"}
              size="sm"
              className="justify-start"
              onClick={() => pick(toISODate(day))}
            >
              {label}
            </Button>
          ))}
        </div>
        <Input
          type="date"
          className="mt-2"
          aria-label="Due date"
          value={dueOn ?? ""}
          onChange={(event) => event.target.value && pick(event.target.value)}
        />
        {dueOn ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground mt-1 w-full justify-start"
            onClick={() => pick(null)}
          >
            <X className="size-4" />
            No due date
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
