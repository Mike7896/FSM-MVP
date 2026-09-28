import "server-only";

import {
  and,
  asc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  max,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  jobs,
  memberships,
  profiles,
  tasks,
  visits,
  type Task,
} from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { notifyLater } from "@/lib/notifications";
import { tagPredicate, tagsForRecords } from "@/lib/queries/tags";
import { titleOf } from "@/lib/schedule/title";
import type { CreateTaskInput, ListTasksInput, UpdateTaskInput } from "@/lib/schemas";

import type { TaskBooking, TaskDetail, TaskStatus, TaskView } from "./types";

/**
 * TASKS — reads and writes.
 *
 * Every function takes an `organizationId` its caller has already proved;
 * Drizzle bypasses RLS, so the scoping in each query is the security.
 *
 * **A task ties into everything else by reference, never by copy.** Its job is
 * a foreign key, so the job's name and address are read, not stored; the time
 * booked to do it lives on the schedule as visits that point back at it; its
 * tags are the shop's tags. Nothing here can drift out of step with the thing
 * it describes.
 */

/** How long a finished task stays on the board before it's history. */
const RECENTLY_CLOSED_DAYS = 14;

/** Board order: by column, then by place in the column. */
const STATUS_ORDER = sql`array_position(array['backlog','todo','in_progress','done','cancelled']::task_status[], ${tasks.status})`;

/* ── Reading ──────────────────────────────────────────────────────────── */

export async function listTasks(
  organizationId: string,
  filter: ListTasksInput = {}
): Promise<TaskView[]> {
  const term = filter.q?.trim();
  const like = term ? `%${term.replace(/[%_\\]/g, "\\$&")}%` : null;
  const since = new Date(Date.now() - RECENTLY_CLOSED_DAYS * 86_400_000);
  // A job's own list is its whole record; the shop's board forgets slowly.
  const allClosed = filter.closed === "all" || Boolean(filter.job);

  const rows = await db
    .select({ task: tasks, job: jobColumns })
    .from(tasks)
    .leftJoin(jobs, eq(tasks.jobId, jobs.id))
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(tasks.organizationId, organizationId),
        filter.job ? eq(tasks.jobId, filter.job) : undefined,
        filter.assignee === "none"
          ? isNull(tasks.assigneeId)
          : filter.assignee
            ? eq(tasks.assigneeId, filter.assignee)
            : undefined,
        like
          ? or(
              ilike(tasks.title, like),
              ilike(tasks.description, like),
              ilike(customers.name, like),
              ilike(jobs.name, like),
              ilike(jobs.address, like),
              sql`'t-' || ${tasks.number}::text = lower(${term})`
            )
          : undefined,
        filter.tags || filter.tagMode === "untagged"
          ? tagPredicate(organizationId, "task", { tags: filter.tags, tagMode: filter.tagMode })
          : undefined,
        allClosed
          ? undefined
          : or(
              notInArray(tasks.status, ["done", "cancelled"]),
              gte(tasks.updatedAt, since)
            )
      )
    )
    .orderBy(STATUS_ORDER, asc(tasks.position), asc(tasks.number));

  return toViews(organizationId, rows);
}

export async function getTask(
  organizationId: string,
  taskId: string
): Promise<TaskDetail | null> {
  const [row] = await db
    .select({ task: tasks, job: jobColumns, createdByName: profiles.fullName, createdByEmail: profiles.email })
    .from(tasks)
    .leftJoin(jobs, eq(tasks.jobId, jobs.id))
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(profiles, eq(profiles.id, tasks.createdBy))
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;

  const [view] = await toViews(organizationId, [row]);
  const booked = await db
    .select({
      id: visits.id,
      kind: visits.kind,
      title: visits.title,
      status: visits.status,
      allDay: visits.allDay,
      startsAt: visits.startsAt,
      endsAt: visits.endsAt,
      startsOn: visits.startsOn,
      endsOn: visits.endsOn,
      jobName: jobs.name,
      customerName: customers.name,
    })
    .from(visits)
    .leftJoin(jobs, eq(visits.jobId, jobs.id))
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(eq(visits.taskId, taskId), eq(visits.organizationId, organizationId)))
    .orderBy(sql`coalesce(${visits.startsAt}, ${visits.startsOn}::timestamptz)`);

  return {
    ...view,
    createdByName: row.createdByName?.trim() || row.createdByEmail || null,
    visits: booked.map((visit) => ({
      id: visit.id,
      title: titleOf(visit.kind, visit.title, visit.jobName, visit.customerName),
      status: visit.status,
      allDay: visit.allDay,
      startsAt: visit.startsAt?.toISOString() ?? null,
      endsAt: visit.endsAt?.toISOString() ?? null,
      startsOn: visit.startsOn,
      endsOn: visit.endsOn,
    })),
  };
}

/* ── Writing ──────────────────────────────────────────────────────────── */

export async function createTask(
  organizationId: string,
  actorUserId: string,
  input: CreateTaskInput
): Promise<TaskView> {
  await checkJob(organizationId, input.jobId);
  await checkAssignee(organizationId, input.assigneeId);

  const [row] = await db
    .insert(tasks)
    .values({
      organizationId,
      title: input.title.trim(),
      description: blank(input.description),
      status: input.status,
      priority: input.priority,
      assigneeId: input.assigneeId,
      jobId: input.jobId,
      dueOn: input.dueOn,
      position: input.position ?? (await endOf(organizationId, input.status)),
      completedAt: input.status === "done" ? new Date() : null,
      createdBy: actorUserId,
    })
    .returning({ id: tasks.id });

  const task = (await getTask(organizationId, row.id))!;
  announce(organizationId, actorUserId, task.id, task.assigneeId);
  return strip(task);
}

export async function updateTask(
  organizationId: string,
  actorUserId: string,
  taskId: string,
  change: UpdateTaskInput
): Promise<TaskView> {
  const [before] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);
  if (!before) throw new DomainError("That task isn't here any more.", "not_found");

  if (change.jobId !== undefined) await checkJob(organizationId, change.jobId);
  if (change.assigneeId !== undefined) await checkAssignee(organizationId, change.assigneeId);

  const moving = change.status !== undefined && change.status !== before.status;
  await db
    .update(tasks)
    .set({
      ...(change.title !== undefined ? { title: change.title.trim() } : {}),
      ...(change.description !== undefined ? { description: blank(change.description) } : {}),
      ...(change.priority !== undefined ? { priority: change.priority } : {}),
      ...(change.assigneeId !== undefined ? { assigneeId: change.assigneeId } : {}),
      ...(change.jobId !== undefined ? { jobId: change.jobId } : {}),
      ...(change.dueOn !== undefined ? { dueOn: change.dueOn } : {}),
      ...(change.status !== undefined ? { status: change.status } : {}),
      // A new column without a place from a drag: the end of it.
      ...(change.position !== undefined
        ? { position: change.position }
        : moving
          ? { position: await endOf(organizationId, change.status!) }
          : {}),
      ...(moving ? { completedAt: change.status === "done" ? new Date() : null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)));

  const task = (await getTask(organizationId, taskId))!;
  if (change.assigneeId !== undefined && change.assigneeId !== before.assigneeId) {
    announce(organizationId, actorUserId, task.id, task.assigneeId);
  }
  return strip(task);
}

export async function deleteTask(organizationId: string, taskId: string) {
  const gone = await db
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .returning({ id: tasks.id });
  if (gone.length === 0) {
    throw new DomainError("That task isn't here any more.", "not_found");
  }
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

const jobColumns = {
  id: jobs.id,
  number: jobs.number,
  name: jobs.name,
  customerName: customers.name,
  address: jobs.address,
  demo: jobs.isDemo,
};

type Row = {
  task: Task;
  job: { id: string | null; number: number | null; name: string | null; customerName: string | null; address: string | null; demo: boolean | null } | null;
};

async function toViews(organizationId: string, rows: Row[]): Promise<TaskView[]> {
  const ids = rows.map((row) => row.task.id);
  const [tagged, bookings] = await Promise.all([
    tagsForRecords(organizationId, "task", ids),
    nextBookings(organizationId, ids),
  ]);

  return rows.map(({ task, job }) => ({
    id: task.id,
    number: task.number,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId,
    dueOn: task.dueOn,
    position: task.position,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    job: job?.id
      ? {
          id: job.id,
          number: job.number ?? 0,
          name: job.name,
          customerName: job.customerName,
          address: job.address,
          demo: job.demo ?? false,
        }
      : null,
    tags: tagged[task.id] ?? [],
    nextBooking: bookings.get(task.id) ?? null,
  }));
}

/** For each task, the soonest visit still ahead that was booked for it. */
async function nextBookings(organizationId: string, taskIds: string[]) {
  const soonest = new Map<string, TaskBooking>();
  if (taskIds.length === 0) return soonest;

  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      taskId: visits.taskId,
      visitId: visits.id,
      allDay: visits.allDay,
      startsAt: visits.startsAt,
      startsOn: visits.startsOn,
      endsAt: visits.endsAt,
      endsOn: visits.endsOn,
    })
    .from(visits)
    .where(
      and(
        eq(visits.organizationId, organizationId),
        inArray(visits.taskId, taskIds),
        eq(visits.status, "scheduled"),
        or(gte(visits.endsAt, new Date()), gte(visits.endsOn, today))
      )
    )
    .orderBy(sql`coalesce(${visits.startsAt}, ${visits.startsOn}::timestamptz)`);

  for (const row of rows) {
    if (!row.taskId || soonest.has(row.taskId)) continue;
    soonest.set(row.taskId, {
      visitId: row.visitId,
      allDay: row.allDay,
      startsAt: row.startsAt?.toISOString() ?? null,
      startsOn: row.startsOn,
    });
  }
  return soonest;
}

/** A place after everything already in the column. */
async function endOf(organizationId: string, status: TaskStatus) {
  const [row] = await db
    .select({ last: max(tasks.position) })
    .from(tasks)
    .where(and(eq(tasks.organizationId, organizationId), eq(tasks.status, status)));
  return (row?.last ?? 0) + 1024;
}

async function checkJob(organizationId: string, jobId: string | null | undefined) {
  if (!jobId) return;
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);
  if (!job) throw new DomainError("No job with that id in this shop.", "not_found");
}

async function checkAssignee(organizationId: string, userId: string | null | undefined) {
  if (!userId) return;
  const [member] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
    .limit(1);
  if (!member) {
    throw new DomainError("Only people on your team can be given a task.", "invalid");
  }
}

/** Tell the person given it — unless they gave it to themselves. */
function announce(
  organizationId: string,
  actorUserId: string,
  taskId: string,
  assigneeId: string | null
) {
  if (!assigneeId || assigneeId === actorUserId) return;
  notifyLater({ kind: "task.assigned", organizationId, actorUserId, taskId, userId: assigneeId });
}

function strip(task: TaskDetail): TaskView {
  return Object.fromEntries(
    Object.entries(task).filter(([key]) => key !== "createdByName" && key !== "visits")
  ) as TaskView;
}

function blank(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A job as the filter and the pickers show it — for a link that names one. */
export async function jobForPicker(organizationId: string, jobId: string) {
  const [row] = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      name: jobs.name,
      customerName: customers.name,
      address: jobs.address,
    })
    .from(jobs)
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}
