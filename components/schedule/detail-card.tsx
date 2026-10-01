"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, ListTodo, MapPin, Pencil, RotateCcw, ShieldCheck, StickyNote, Trash2, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fromISODate, timeRangeLabel } from "@/lib/schedule/dates";
import { DueLabel, PriorityIcon, StatusIcon } from "@/components/tasks/task-bits";
import type {
  ScheduleInspection,
  ScheduleTask,
  ScheduleVisit,
  TeamMember,
} from "@/lib/schedule/types";
import { priorityLabel, statusLabel, taskKey } from "@/lib/tasks/types";
import { visitKind } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

import type { Swatch } from "./colors";
import { jobLabel } from "@/components/jobs/job-picker";

/**
 * What a visit is, where you clicked it — the small card Google Calendar opens
 * beside an event.
 *
 * Reading is the common case — where is it, who's on it, what's the address —
 * so the card is for reading, with the three things done to a visit most
 * often one tap away: change it, mark it done, take it off.
 */

type Anchor = { x: number; y: number };

export function VisitCard({
  visit,
  at,
  team,
  colorOf,
  personColor,
  onEdit,
  onStatus,
  onDelete,
  onClose,
}: {
  visit: ScheduleVisit;
  at: Anchor;
  team: TeamMember[];
  colorOf: (visit: ScheduleVisit) => Swatch;
  personColor: (userId: string) => Swatch;
  onEdit: () => void;
  onStatus: (status: ScheduleVisit["status"]) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const people = visit.assignees
    .map((userId) => team.find((member) => member.userId === userId))
    .filter((member) => member !== undefined);

  return (
    <Floating at={at} onClose={onClose}>
      <div className="flex items-center justify-end gap-0.5 px-2 pt-2">
        <IconButton label="Change it" onClick={onEdit}>
          <Pencil className="size-4" />
        </IconButton>
        <IconButton label="Delete" onClick={onDelete}>
          <Trash2 className="size-4" />
        </IconButton>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="flex flex-col gap-3 px-5 pb-4">
        <div className="flex gap-3">
          <span className={cn("mt-1.5 size-3 shrink-0 rounded-sm", colorOf(visit).dot)} />
          <div className="min-w-0">
            <p className={cn("text-base leading-snug font-semibold", visit.status === "cancelled" && "line-through")}>
              {visit.title}
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">{whenOf(visit)}</p>
            {kindLine(visit) ? (
              <p className="text-muted-foreground mt-0.5 text-xs">{kindLine(visit)}</p>
            ) : null}
          </div>
        </div>

        {visit.task ? (
          <Row icon={<ListTodo className="size-4" />}>
            <Link href={`/tasks?task=${visit.task.id}`} className="hover:underline">
              <span className="text-muted-foreground tabular-nums">{taskKey(visit.task.number)}</span>{" "}
              {visit.task.title}
            </Link>
          </Row>
        ) : null}

        {visit.job ? (
          <Row icon={<MapPin className="size-4" />}>
            <Link href={`/jobs/${visit.job.id}`} className="hover:underline font-medium">
              {jobLabel(visit.job)}
            </Link>
            {visit.job.address ? (
              <span className="text-muted-foreground block">{visit.job.address}</span>
            ) : null}
          </Row>
        ) : null}

        <Row icon={<Users className="size-4" />}>
          {people.length ? (
            <ul className="flex flex-col gap-1">
              {people.map((member) => (
                <li key={member.userId} className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", personColor(member.userId).dot)} />
                  {member.name}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">Nobody on it yet</span>
          )}
        </Row>

        {visit.notes ? (
          <Row icon={<StickyNote className="size-4" />}>
            <span className="whitespace-pre-line">{visit.notes}</span>
          </Row>
        ) : null}

        {visit.kind !== "time_off" ? (
          <div className="flex gap-2 pt-1">
            {visit.status === "scheduled" ? (
              <Button size="sm" variant="outline" onClick={() => onStatus("done")}>
                <CheckCircle2 className="size-4" />
                Mark done
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => onStatus("scheduled")}>
                <RotateCcw className="size-4" />
                Back on the schedule
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </Floating>
  );
}

export function InspectionCard({
  inspection,
  at,
  onClose,
}: {
  inspection: ScheduleInspection;
  at: Anchor;
  onClose: () => void;
}) {
  const type = inspection.type.replace(/_/g, "-");
  return (
    <Floating at={at} onClose={onClose}>
      <div className="flex justify-end px-2 pt-2">
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="flex flex-col gap-3 px-5 pb-4">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-base leading-snug font-semibold capitalize">{type} inspection</p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {fromISODate(inspection.on).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              {inspection.result !== "scheduled" ? ` · ${inspection.result}` : ""}
            </p>
          </div>
        </div>
        <Row icon={<MapPin className="size-4" />}>
          <span className="font-medium">{jobLabel(inspection.job)}</span>
          {inspection.job.address ? (
            <span className="text-muted-foreground block">{inspection.job.address}</span>
          ) : null}
        </Row>
        <p className="text-muted-foreground text-xs">
          Its date lives on the permit. Change it there, and it moves here.
        </p>
        <Button asChild size="sm" variant="outline" className="self-start">
          <Link href={`/jobs/${inspection.job.id}/permits/${inspection.permitId}`}>
            Open the permit
          </Link>
        </Button>
      </div>
    </Floating>
  );
}

/**
 * A task due that day. Read here, changed on the task — its date is the
 * task's, the way an inspection's is the permit's.
 */
export function TaskCard({
  task,
  at,
  team,
  personColor,
  onClose,
}: {
  task: ScheduleTask;
  at: Anchor;
  team: TeamMember[];
  personColor: (userId: string) => Swatch;
  onClose: () => void;
}) {
  const member = team.find((person) => person.userId === task.assigneeId);
  return (
    <Floating at={at} onClose={onClose}>
      <div className="flex justify-end px-2 pt-2">
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="flex flex-col gap-3 px-5 pb-4">
        <div className="flex gap-3">
          <StatusIcon status={task.status} className="mt-1 size-4" />
          <div className="min-w-0">
            <p className={cn("text-base leading-snug font-semibold", task.status === "done" && "line-through")}>
              {task.title}
            </p>
            <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-sm">
              <span className="tabular-nums">{taskKey(task.number)}</span>·<span>Due</span>
              <DueLabel dueOn={task.dueOn} status={task.status} className="text-sm" />
            </p>
            <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
              {statusLabel(task.status)}
              {task.priority !== "none" ? (
                <>
                  <span>·</span>
                  <PriorityIcon priority={task.priority} className="size-3" />
                  {priorityLabel(task.priority)}
                </>
              ) : null}
            </p>
          </div>
        </div>
        {task.job ? (
          <Row icon={<MapPin className="size-4" />}>
            <Link href={`/jobs/${task.job.id}`} className="font-medium hover:underline">
              {jobLabel(task.job)}
            </Link>
            {task.job.address ? <span className="text-muted-foreground block">{task.job.address}</span> : null}
          </Row>
        ) : null}
        <Row icon={<Users className="size-4" />}>
          {member ? (
            <span className="flex items-center gap-2">
              <span className={cn("size-2 rounded-full", personColor(member.userId).dot)} />
              {member.name}
            </span>
          ) : (
            <span className="text-muted-foreground">Nobody yet</span>
          )}
        </Row>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" variant="outline">
            <Link href={`/tasks?task=${task.id}`}>Open the task</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/schedule?book=${task.id}`}>Book time for it</Link>
          </Button>
        </div>
      </div>
    </Floating>
  );
}

/** "Job work · Done" — the kind is left out when it's already the title. */
function kindLine(visit: ScheduleVisit) {
  const kind = visitKind(visit.kind).label;
  const status = visit.status === "done" ? "Done" : visit.status === "cancelled" ? "Cancelled" : null;
  return [kind === visit.title ? null : kind, status].filter(Boolean).join(" · ");
}

/** "Tue, Oct 6 · 8 – 11 AM", or "Oct 8 – 9 · all day". */
function whenOf(visit: ScheduleVisit) {
  if (visit.allDay) {
    const first = fromISODate(visit.startsOn!);
    const last = fromISODate(visit.endsOn!);
    const day = (date: Date) =>
      date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return visit.startsOn === visit.endsOn
      ? `${day(first)} · all day`
      : `${day(first)} – ${day(last)} · all day`;
  }
  const start = new Date(visit.startsAt!);
  const end = new Date(visit.endsAt!);
  return `${start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${timeRangeLabel(start, end)}`;
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button variant="ghost" size="icon" className="text-muted-foreground size-8" aria-label={label} title={label} onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * A card placed beside the click, kept on screen, closed by Escape or a click
 * anywhere else.
 */
function Floating({
  at,
  onClose,
  children,
}: {
  at: Anchor;
  onClose: () => void;
  children: ReactNode;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: at.x + 12, top: at.y - 20 });

  useLayoutEffect(() => {
    const rect = card.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 12;
    let left = at.x + 12;
    if (left + rect.width > window.innerWidth - margin) left = at.x - rect.width - 12;
    left = Math.max(margin, left);
    const top = Math.min(Math.max(margin, at.y - 20), window.innerHeight - rect.height - margin);
    setPosition({ left, top });
  }, [at.x, at.y]);

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (card.current && !card.current.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Deferred, so the click that opened the card isn't also the one that closes it.
    const timer = setTimeout(() => window.addEventListener("pointerdown", away), 0);
    window.addEventListener("keydown", escape);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  return (
    <div
      ref={card}
      role="dialog"
      className="bg-popover text-popover-foreground fixed z-50 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border shadow-lg"
      style={position}
    >
      {children}
    </div>
  );
}
