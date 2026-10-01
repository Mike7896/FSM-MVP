"use client";

import { useMemo, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, Plus } from "lucide-react";

import { jobLabel } from "@/components/jobs/job-picker";
import { TagBadges } from "@/components/tags/tag-controls";
import { Button } from "@/components/ui/button";
import { fromISODate } from "@/lib/schedule/dates";
import { taskKey, TASK_STATUSES, type TaskStatus, type TaskView } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

import { DueLabel, PersonAvatar, PriorityIcon, StatusIcon } from "./task-bits";
import { AssigneeMenu, PriorityMenu } from "./task-menus";
import type { PanelPeople } from "./task-panel";
import { between, type TaskChange } from "./use-tasks";

/**
 * The board — tasks in columns by where they've got to.
 *
 * **A drag is a status change and a place, and nothing else.** Dropping a card
 * in In progress says somebody's on it; dropping it between two cards says
 * it comes between them. One write, the card's own row, and it's there before
 * the server answers.
 *
 * Cancelled work isn't a column: a board is what's moving. It's still in the
 * list, under its own heading.
 */

const COLUMNS: TaskStatus[] = ["backlog", "todo", "in_progress", "done"];

type Columns = Record<TaskStatus, string[]>;

function group(tasks: TaskView[]): Columns {
  const columns: Columns = { backlog: [], todo: [], in_progress: [], done: [], cancelled: [] };
  for (const task of [...tasks].sort((a, b) => a.position - b.position || a.number - b.number)) {
    columns[task.status].push(task.id);
  }
  return columns;
}

export function TaskBoard({
  tasks,
  people,
  onOpen,
  onChange,
  onAdd,
}: {
  tasks: TaskView[];
  people: PanelPeople;
  onOpen: (task: TaskView) => void;
  onChange: (task: TaskView, change: TaskChange) => void;
  onAdd: (status: TaskStatus) => void;
}) {
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const [dragging, setDragging] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const columns = dragging ?? group(tasks);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // A finger has to rest on a card a moment, so a swipe still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const columnOf = (id: string, within: Columns = columns): TaskStatus | null => {
    if ((COLUMNS as string[]).includes(id)) return id as TaskStatus;
    return (Object.keys(within) as TaskStatus[]).find((status) => within[status].includes(id)) ?? null;
  };

  function start(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setDragging(group(tasks));
  }

  function over(event: DragOverEvent) {
    const { active, over: target } = event;
    if (!target || !dragging) return;
    const from = columnOf(String(active.id), dragging);
    const to = columnOf(String(target.id), dragging);
    if (!from || !to || from === to) return;

    setDragging((current) => {
      if (!current) return current;
      const source = current[from].filter((id) => id !== active.id);
      const destination = [...current[to]];
      const at = destination.indexOf(String(target.id));
      destination.splice(at >= 0 ? at : destination.length, 0, String(active.id));
      return { ...current, [from]: source, [to]: destination };
    });
  }

  function end(event: DragEndEvent) {
    const { active, over: target } = event;
    const id = String(active.id);
    const current = dragging;
    setActiveId(null);
    setDragging(null);
    const task = byId.get(id);
    if (!target || !current || !task) return;

    // Released over a column the card hadn't been dragged into yet — a fast
    // flick — still lands there.
    const from = columnOf(id, current);
    const into = columnOf(String(target.id), current);
    let settled = current;
    if (from && into && from !== into) {
      const destination = current[into].filter((other) => other !== id);
      const at = destination.indexOf(String(target.id));
      destination.splice(at >= 0 ? at : destination.length, 0, id);
      settled = { ...current, [from]: current[from].filter((other) => other !== id), [into]: destination };
    }

    const column = columnOf(id, settled);
    if (!column) return;
    let order = settled[column];
    const overIndex = order.indexOf(String(target.id));
    const fromIndex = order.indexOf(id);
    if (overIndex >= 0 && overIndex !== fromIndex) order = arrayMove(order, fromIndex, overIndex);

    const index = order.indexOf(id);
    const before = order[index - 1] ? byId.get(order[index - 1])?.position : undefined;
    const after = order[index + 1] ? byId.get(order[index + 1])?.position : undefined;
    // Picked up and put back where it was: nothing to write.
    if (column === task.status && order.join() === group(tasks)[column].join()) return;

    onChange(task, {
      ...(column !== task.status ? { status: column } : {}),
      position: between(before, after),
    });
  }

  const active = activeId ? byId.get(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={start}
      onDragOver={over}
      onDragEnd={end}
      onDragCancel={() => {
        setActiveId(null);
        setDragging(null);
      }}
    >
      <div className="flex h-full min-h-0 snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:snap-none md:px-5">
        {COLUMNS.map((status) => (
          <Column
            key={status}
            status={status}
            ids={columns[status]}
            byId={byId}
            people={people}
            onOpen={onOpen}
            onChange={onChange}
            onAdd={() => onAdd(status)}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>
        {active ? <Card task={active} people={people} lifted /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  ids,
  byId,
  people,
  onOpen,
  onChange,
  onAdd,
}: {
  status: TaskStatus;
  ids: string[];
  byId: Map<string, TaskView>;
  people: PanelPeople;
  onOpen: (task: TaskView) => void;
  onChange: (task: TaskView, change: TaskChange) => void;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const label = TASK_STATUSES.find((entry) => entry.status === status)!.label;

  return (
    <section
      aria-label={label}
      className="bg-muted/40 flex max-h-full w-[min(18rem,calc(100vw-3rem))] shrink-0 snap-start flex-col rounded-xl border md:w-auto md:min-w-60 md:max-w-96 md:flex-1 md:basis-0"
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <StatusIcon status={status} />
        <h2 className="text-sm font-medium">{label}</h2>
        <span className="text-muted-foreground text-xs tabular-nums">{ids.length}</span>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground ml-auto size-7"
          aria-label={`New task in ${label}`}
          title={`New task in ${label}`}
          onClick={onAdd}
        >
          <Plus className="size-4" />
        </Button>
      </header>
      <SortableContext id={status} items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors",
            isOver && "bg-muted/60 rounded-b-xl"
          )}
        >
          {ids.map((id) => {
            const task = byId.get(id);
            return task ? (
              <SortableCard key={id} task={task} people={people} onOpen={onOpen} onChange={onChange} />
            ) : null;
          })}
          {ids.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-xs">Nothing here</p>
          ) : null}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({
  task,
  people,
  onOpen,
  onChange,
}: {
  task: TaskView;
  people: PanelPeople;
  onOpen: (task: TaskView) => void;
  onChange: (task: TaskView, change: TaskChange) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task)}
      onKeyDown={(event) => {
        listeners?.onKeyDown?.(event);
        if (event.key === "Enter" && !event.defaultPrevented) onOpen(task);
      }}
    >
      <Card task={task} people={people} onChange={onChange} />
    </div>
  );
}

function Card({
  task,
  people,
  onChange,
  lifted = false,
}: {
  task: TaskView;
  people: PanelPeople;
  onChange?: (task: TaskView, change: TaskChange) => void;
  lifted?: boolean;
}) {
  const member = people.team.find((person) => person.userId === task.assigneeId) ?? null;

  return (
    <article
      className={cn(
        "bg-card hover:border-foreground/20 cursor-grab rounded-lg border p-3 text-left shadow-xs transition-colors select-none",
        lifted && "rotate-1 cursor-grabbing shadow-lg"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs tabular-nums">{taskKey(task.number)}</span>
        <span className="ml-auto">
          {onChange ? (
            <AssigneeMenu
              assigneeId={task.assigneeId}
              team={people.team}
              me={people.me}
              colorOf={people.colorOf}
              onChange={(assigneeId) => onChange(task, { assigneeId })}
              className="-m-1"
            />
          ) : (
            <PersonAvatar member={member} swatch={member ? people.colorOf(member.userId) : undefined} />
          )}
        </span>
      </div>
      <p className={cn("mt-1 line-clamp-3 text-sm leading-snug font-medium", task.status === "done" && "text-muted-foreground")}>
        {task.title}
      </p>
      {task.job ? (
        <p className="text-muted-foreground mt-1 truncate text-xs">{jobLabel(task.job)}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {onChange ? (
          <PriorityMenu priority={task.priority} onChange={(priority) => onChange(task, { priority })} className="-m-1" />
        ) : (
          <PriorityIcon priority={task.priority} />
        )}
        {task.dueOn ? <DueLabel dueOn={task.dueOn} status={task.status} /> : null}
        {task.nextBooking ? <Booked booking={task.nextBooking} /> : null}
        {task.tags.length ? <TagBadges tags={task.tags} /> : null}
      </div>
    </article>
  );
}

/** "Booked Tue" — there's time on the schedule for it. */
export function Booked({ booking, className }: { booking: NonNullable<TaskView["nextBooking"]>; className?: string }) {
  const day = booking.startsAt ? new Date(booking.startsAt) : fromISODate(booking.startsOn!);
  const label = day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return (
    <span className={cn("text-muted-foreground inline-flex items-center gap-1 text-xs", className)} title={`Booked on the schedule for ${label}`}>
      <CalendarClock className="size-3.5" />
      {day.toLocaleDateString("en-US", { weekday: "short" })}
    </span>
  );
}
