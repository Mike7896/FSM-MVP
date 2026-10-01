import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  inspections,
  jobs,
  memberships,
  profiles,
  tasks,
  visitAssignees,
  visits,
  type Visit,
} from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { notifyLater } from "@/lib/notifications";
import type { CreateVisitInput, UpdateVisitInput } from "@/lib/schemas";

import { titleOf } from "./title";
import {
  visitKind,
  type ScheduleConflict,
  type ScheduleInspection,
  type ScheduleJob,
  type ScheduleRange,
  type ScheduleTask,
  type ScheduleVisit,
  type TeamMember,
} from "./types";

/**
 * THE SCHEDULE — reads and writes.
 *
 * Every function takes an `organizationId` its caller has already proved;
 * Drizzle bypasses RLS, so the scoping in each query is the security.
 *
 * **Double-booking is said, never refused.** A contractor who puts two people
 * on one job and one of them on two jobs at once may well mean it — the second
 * job is next door. So a write that overlaps somebody's other booking, or their
 * time off, goes through and comes back with the conflicts named, for the page
 * to say out loud.
 */

/* ── Reading ──────────────────────────────────────────────────────────── */

export async function listSchedule(
  organizationId: string,
  range: { start: Date; end: Date; startDate: string; endDate: string }
): Promise<ScheduleRange> {
  const [rows, booked, due] = await Promise.all([
    db
      .select({ visit: visits, job: jobColumns, task: taskColumns })
      .from(visits)
      .leftJoin(jobs, eq(visits.jobId, jobs.id))
      .leftJoin(customers, eq(jobs.customerId, customers.id))
      .leftJoin(tasks, eq(visits.taskId, tasks.id))
      .where(
        and(
          eq(visits.organizationId, organizationId),
          or(
            // Timed: overlaps the window at all.
            and(lt(visits.startsAt, range.end), gt(visits.endsAt, range.start)),
            // All day: any of its dates inside the window's.
            and(lte(visits.startsOn, range.endDate), gte(visits.endsOn, range.startDate))
          )
        )
      )
      .orderBy(asc(visits.startsAt), asc(visits.startsOn)),

    db
      .select({
        id: inspections.id,
        type: inspections.type,
        result: inspections.result,
        on: inspections.scheduledOn,
        permitId: inspections.permitId,
        job: jobColumns,
      })
      .from(inspections)
      .innerJoin(jobs, eq(inspections.jobId, jobs.id))
      .leftJoin(customers, eq(jobs.customerId, customers.id))
      .where(
        and(
          eq(jobs.organizationId, organizationId),
          isNotNull(inspections.scheduledOn),
          gte(inspections.scheduledOn, range.startDate),
          lte(inspections.scheduledOn, range.endDate),
          ne(inspections.result, "cancelled")
        )
      ),

    // Tasks due in the window. Cancelled ones aren't anything to do.
    db
      .select({
        id: tasks.id,
        number: tasks.number,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueOn: tasks.dueOn,
        assigneeId: tasks.assigneeId,
        job: jobColumns,
      })
      .from(tasks)
      .leftJoin(jobs, eq(tasks.jobId, jobs.id))
      .leftJoin(customers, eq(jobs.customerId, customers.id))
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          isNotNull(tasks.dueOn),
          gte(tasks.dueOn, range.startDate),
          lte(tasks.dueOn, range.endDate),
          ne(tasks.status, "cancelled")
        )
      )
      .orderBy(asc(tasks.dueOn), asc(tasks.number)),
  ]);

  const staff = await assigneesOf(rows.map((row) => row.visit.id));

  return {
    visits: rows.map((row) =>
      toView(row.visit, row.job?.id ? (row.job as ScheduleJob) : null, staff, row.task)
    ),
    inspections: booked.map(
      (row): ScheduleInspection => ({
        id: row.id,
        type: row.type,
        result: row.result,
        on: row.on!,
        permitId: row.permitId,
        job: row.job as ScheduleJob,
      })
    ),
    tasks: due.map(
      (row): ScheduleTask => ({
        id: row.id,
        number: row.number,
        title: row.title,
        status: row.status,
        priority: row.priority,
        dueOn: row.dueOn!,
        assigneeId: row.assigneeId,
        job: row.job?.id ? (row.job as ScheduleJob) : null,
      })
    ),
  };
}

export async function getVisit(
  organizationId: string,
  visitId: string
): Promise<ScheduleVisit | null> {
  const [row] = await db
    .select({ visit: visits, job: jobColumns, task: taskColumns })
    .from(visits)
    .leftJoin(jobs, eq(visits.jobId, jobs.id))
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(tasks, eq(visits.taskId, tasks.id))
    .where(and(eq(visits.id, visitId), eq(visits.organizationId, organizationId)))
    .limit(1);

  if (!row) return null;
  const staff = await assigneesOf([visitId]);
  return toView(row.visit, row.job?.id ? (row.job as ScheduleJob) : null, staff, row.task);
}

/** Everyone who can be put on a visit — the Office's members. */
export async function listTeam(organizationId: string): Promise<TeamMember[]> {
  const rows = await db
    .select({
      userId: memberships.userId,
      role: memberships.role,
      name: profiles.fullName,
      email: profiles.email,
    })
    .from(memberships)
    .innerJoin(profiles, eq(profiles.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(asc(profiles.fullName), asc(profiles.email));

  return rows.map((row) => ({
    userId: row.userId,
    role: row.role,
    email: row.email,
    // A person who never gave a name is their address, not "Unnamed".
    name: row.name?.trim() || row.email,
  }));
}

/** The job picker: open jobs first, newest first, matching what's typed. */
export async function searchJobs(
  organizationId: string,
  query: string | undefined
): Promise<ScheduleJob[]> {
  const term = query?.trim();
  const like = term ? `%${term.replace(/[%_\\]/g, "\\$&")}%` : null;

  return db
    .select(jobColumns)
    .from(jobs)
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        like
          ? or(
              ilike(jobs.name, like),
              ilike(customers.name, like),
              ilike(jobs.address, like),
              sql`${jobs.number}::text = ${term}`
            )
          : undefined
      )
    )
    // Finished work is still bookable — a warranty call — but it sorts last.
    .orderBy(
      sql`case when ${jobs.status} in ('complete', 'paid') then 1 else 0 end`,
      desc(jobs.createdAt)
    )
    .limit(12) as Promise<ScheduleJob[]>;
}

/* ── Writing ──────────────────────────────────────────────────────────── */

export async function createVisit(
  organizationId: string,
  actorUserId: string,
  input: CreateVisitInput
): Promise<{ visit: ScheduleVisit; conflicts: ScheduleConflict[] }> {
  const shape = checkShape(input);
  await checkJob(organizationId, input.jobId);
  await checkTeam(organizationId, input.assignees);
  await checkTask(organizationId, input.taskId);

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(visits)
      .values({
        organizationId,
        jobId: shape.jobId,
        kind: input.kind,
        title: blank(input.title),
        notes: blank(input.notes),
        status: input.status,
        taskId: input.taskId,
        createdBy: actorUserId,
        ...shape.time,
      })
      .returning({ id: visits.id });

    if (input.assignees.length) {
      await tx
        .insert(visitAssignees)
        .values(unique(input.assignees).map((userId) => ({ visitId: row.id, userId })));
    }
    return row.id;
  });

  const visit = (await getVisit(organizationId, id))!;
  announce(organizationId, actorUserId, visit, visit.assignees, input.timeZone);

  return {
    visit,
    conflicts: await conflictsFor(organizationId, visit, input.timeZone),
  };
}

export async function updateVisit(
  organizationId: string,
  actorUserId: string,
  visitId: string,
  change: UpdateVisitInput
): Promise<{ visit: ScheduleVisit; conflicts: ScheduleConflict[] }> {
  const before = await getVisit(organizationId, visitId);
  if (!before) throw new DomainError("That visit isn't on the schedule.", "not_found");

  // The whole visit as it will stand, checked as one — a drag that turns a
  // timed visit all-day has to send both halves of the new shape.
  const merged = {
    kind: change.kind ?? before.kind,
    jobId: change.jobId !== undefined ? change.jobId : (before.job?.id ?? null),
    allDay: change.allDay ?? before.allDay,
    startsAt: change.startsAt !== undefined ? change.startsAt : before.startsAt,
    endsAt: change.endsAt !== undefined ? change.endsAt : before.endsAt,
    startsOn: change.startsOn !== undefined ? change.startsOn : before.startsOn,
    endsOn: change.endsOn !== undefined ? change.endsOn : before.endsOn,
  };
  // Switching shape clears the other one, so a caller never has to null out
  // the half it isn't using.
  if (change.allDay === true) Object.assign(merged, { startsAt: null, endsAt: null });
  if (change.allDay === false) Object.assign(merged, { startsOn: null, endsOn: null });

  const shape = checkShape(merged);
  if (change.jobId !== undefined) await checkJob(organizationId, change.jobId);
  if (change.assignees) await checkTeam(organizationId, change.assignees);
  if (change.taskId !== undefined) await checkTask(organizationId, change.taskId);

  await db.transaction(async (tx) => {
    await tx
      .update(visits)
      .set({
        kind: merged.kind,
        jobId: shape.jobId,
        ...shape.time,
        ...(change.title !== undefined ? { title: blank(change.title) } : {}),
        ...(change.notes !== undefined ? { notes: blank(change.notes) } : {}),
        ...(change.status ? { status: change.status } : {}),
        ...(change.taskId !== undefined ? { taskId: change.taskId } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(visits.id, visitId), eq(visits.organizationId, organizationId)));

    if (change.assignees) {
      await tx.delete(visitAssignees).where(eq(visitAssignees.visitId, visitId));
      if (change.assignees.length) {
        await tx
          .insert(visitAssignees)
          .values(unique(change.assignees).map((userId) => ({ visitId, userId })));
      }
    }
  });

  const visit = (await getVisit(organizationId, visitId))!;

  // Who needs telling: anyone newly on it, and everyone on it when the time
  // moved. A retitle or a note tells nobody.
  const moved =
    visit.startsAt !== before.startsAt ||
    visit.startsOn !== before.startsOn ||
    visit.endsOn !== before.endsOn;
  const told = moved
    ? visit.assignees
    : visit.assignees.filter((userId) => !before.assignees.includes(userId));
  if (visit.status === "scheduled") {
    announce(organizationId, actorUserId, visit, told, change.timeZone);
  }

  return {
    visit,
    conflicts: await conflictsFor(organizationId, visit, change.timeZone),
  };
}

export async function deleteVisit(organizationId: string, visitId: string) {
  const gone = await db
    .delete(visits)
    .where(and(eq(visits.id, visitId), eq(visits.organizationId, organizationId)))
    .returning({ id: visits.id });

  if (gone.length === 0) {
    throw new DomainError("That visit isn't on the schedule.", "not_found");
  }
}

/* ── Conflicts ────────────────────────────────────────────────────────── */

/**
 * The other bookings that overlap this one for anybody on it.
 *
 * Timed against timed is instant arithmetic. All-day against all-day is date
 * arithmetic. Timed against all-day — the one that matters most, someone booked
 * over their day off — needs the dates a timed visit falls on, which depends
 * on whose clock; the browser's zone is used when it was sent.
 */
export async function conflictsFor(
  organizationId: string,
  visit: ScheduleVisit,
  timeZone?: string
): Promise<ScheduleConflict[]> {
  if (visit.assignees.length === 0 || visit.status === "cancelled") return [];

  const days = visit.allDay
    ? { from: visit.startsOn!, to: visit.endsOn! }
    : timeZone
      ? { from: localDate(visit.startsAt!, timeZone), to: localDate(visit.endsAt!, timeZone) }
      : null;

  const overlaps = [
    visit.allDay
      ? null
      : and(
          lt(visits.startsAt, new Date(visit.endsAt!)),
          gt(visits.endsAt, new Date(visit.startsAt!))
        ),
    days ? and(lte(visits.startsOn, days.to), gte(visits.endsOn, days.from)) : null,
  ].filter((clause) => clause !== null);

  // An all-day visit next to timed ones needs a zone to compare against; with
  // none, only the all-day ones are checked.
  if (visit.allDay && timeZone) {
    overlaps.push(
      and(
        isNotNull(visits.startsAt),
        sql`(${visits.startsAt} at time zone ${timeZone})::date <= ${days!.to}::date`,
        sql`(${visits.endsAt} at time zone ${timeZone})::date >= ${days!.from}::date`
      )!
    );
  }
  if (overlaps.length === 0) return [];

  const rows = await db
    .select({
      visitId: visits.id,
      kind: visits.kind,
      title: visits.title,
      jobName: jobs.name,
      customerName: customers.name,
      userId: visitAssignees.userId,
    })
    .from(visits)
    .innerJoin(visitAssignees, eq(visitAssignees.visitId, visits.id))
    .leftJoin(jobs, eq(visits.jobId, jobs.id))
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(visits.organizationId, organizationId),
        ne(visits.id, visit.id),
        ne(visits.status, "cancelled"),
        inArray(visitAssignees.userId, visit.assignees),
        or(...overlaps)
      )
    );

  return rows.map((row) => ({
    userId: row.userId,
    visitId: row.visitId,
    kind: row.kind,
    title: titleOf(row.kind, row.title, row.jobName, row.customerName),
  }));
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

const jobColumns = {
  id: jobs.id,
  number: jobs.number,
  name: jobs.name,
  customerName: customers.name,
  address: jobs.address,
};

const taskColumns = {
  id: tasks.id,
  number: tasks.number,
  title: tasks.title,
};

async function assigneesOf(visitIds: string[]) {
  const staff = new Map<string, string[]>();
  if (visitIds.length === 0) return staff;

  const rows = await db
    .select({ visitId: visitAssignees.visitId, userId: visitAssignees.userId })
    .from(visitAssignees)
    .where(inArray(visitAssignees.visitId, visitIds));

  for (const row of rows) {
    staff.set(row.visitId, [...(staff.get(row.visitId) ?? []), row.userId]);
  }
  return staff;
}

function toView(
  visit: Visit,
  job: ScheduleJob | null,
  staff: Map<string, string[]>,
  task: { id: string | null; number: number | null; title: string | null } | null
): ScheduleVisit {
  return {
    id: visit.id,
    kind: visit.kind,
    status: visit.status,
    title: titleOf(visit.kind, visit.title, job?.name ?? null, job?.customerName ?? null),
    customTitle: visit.title,
    notes: visit.notes,
    allDay: visit.allDay,
    startsAt: visit.startsAt?.toISOString() ?? null,
    endsAt: visit.endsAt?.toISOString() ?? null,
    startsOn: visit.startsOn,
    endsOn: visit.endsOn,
    job,
    assignees: staff.get(visit.id) ?? [],
    task: task?.id ? { id: task.id, number: task.number ?? 0, title: task.title ?? "" } : null,
  };
}

/** The visit's time as the table holds it, and its job, or a sentence. */
function checkShape(input: {
  kind: CreateVisitInput["kind"];
  jobId: string | null;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startsOn: string | null;
  endsOn: string | null;
}) {
  if (visitKind(input.kind).needsJob && !input.jobId) {
    throw new DomainError(
      input.kind === "estimate"
        ? "Pick the job this estimate is for."
        : "Pick the job this work is on.",
      "invalid",
      [{ field: "jobId", message: "Pick a job." }]
    );
  }

  if (input.allDay) {
    if (!input.startsOn || !input.endsOn) {
      throw new DomainError("An all-day visit needs its first and last day.", "invalid");
    }
    if (input.endsOn < input.startsOn) {
      throw new DomainError("The last day can't be before the first.", "invalid");
    }
    return {
      jobId: input.jobId,
      time: { allDay: true, startsOn: input.startsOn, endsOn: input.endsOn, startsAt: null, endsAt: null },
    };
  }

  if (!input.startsAt || !input.endsAt) {
    throw new DomainError("A visit needs a start and an end time.", "invalid");
  }
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (endsAt <= startsAt) {
    throw new DomainError("It has to end after it starts.", "invalid");
  }
  return {
    jobId: input.jobId,
    time: { allDay: false, startsAt, endsAt, startsOn: null, endsOn: null },
  };
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

async function checkTask(organizationId: string, taskId: string | null | undefined) {
  if (!taskId) return;
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);
  if (!task) throw new DomainError("No task with that id in this shop.", "not_found");
}

async function checkTeam(organizationId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const members = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        inArray(memberships.userId, unique(userIds))
      )
    );
  if (members.length !== unique(userIds).length) {
    throw new DomainError("Only people on your team can be put on a visit.", "invalid");
  }
}

/** Tell the people on it — never the person who booked it. */
function announce(
  organizationId: string,
  actorUserId: string,
  visit: ScheduleVisit,
  userIds: string[],
  timeZone: string | undefined
) {
  if (visit.kind === "time_off") return;
  for (const userId of userIds) {
    if (userId === actorUserId) continue;
    notifyLater({
      kind: "visit.booked",
      organizationId,
      actorUserId,
      visitId: visit.id,
      userId,
      timeZone,
    });
  }
}

/** The calendar date an instant falls on, on a given clock. */
function localDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function blank(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
