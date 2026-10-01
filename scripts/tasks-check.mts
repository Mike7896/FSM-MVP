/**
 * Tasks, checked against a real database.
 *
 * - **A task belongs to one shop**, and to one of its jobs or to the shop
 *   itself; another shop's job, or a stranger, is refused.
 * - **Numbers count per shop** — T-1, T-2 — and never collide.
 * - **Moving a task is its status and its place**; done stamps when, reopening
 *   clears it.
 * - **It ties in by reference**: tags are the shop's tags, time booked for it is
 *   a visit on the schedule, its due date shows on the schedule, the
 *   dashboard's week and the search.
 * - **Giving someone a task tells them**, and nobody else.
 *
 * Its writes commit, so it works in throwaway shops, removed at the end. The
 * only real person involved is the one named in `TASKS_CHECK_EMAIL` (the
 * checker's own account), added to the throwaway shop for the run.
 *
 *     TASKS_CHECK_EMAIL=you@example.com npm run tasks:check
 */

import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema/office";
import { compose } from "@/lib/notifications/compose";
import { getDashboard } from "@/lib/queries/dashboard";
import { searchKind } from "@/lib/queries/search";
import { createVisit, listSchedule } from "@/lib/schedule/service";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
} from "@/lib/tasks/service";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function refuses(label: string, run: () => Promise<unknown>, expect?: RegExp) {
  try {
    await run();
    check(label, false, "it was allowed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, expect ? expect.test(message) : true, message);
  }
}

const email = process.env.TASKS_CHECK_EMAIL;
if (!email) {
  console.error("Set TASKS_CHECK_EMAIL to your own sign-in address.");
  process.exit(1);
}

const [me] = await db.execute<{ id: string }>(
  sql`select id from profiles where email = ${email} limit 1`
);
if (!me) {
  console.error(`No profile for ${email}.`);
  process.exit(1);
}

const SLUG = `tasks-check-${Date.now()}`;
const [org] = await db.execute<{ id: string }>(
  sql`insert into organizations (name, slug) values ('Tasks Check', ${SLUG}) returning id`
);
const [other] = await db.execute<{ id: string }>(
  sql`insert into organizations (name, slug) values ('Someone Else', ${`${SLUG}-other`}) returning id`
);

const today = new Date().toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const blank = {
  description: null,
  status: "todo" as const,
  priority: "none" as const,
  assigneeId: null,
  jobId: null,
  dueOn: null,
};

try {
  await db.execute(
    sql`insert into memberships (organization_id, user_id, role) values (${org.id}, ${me.id}, 'owner')`
  );
  const [customer] = await db.execute<{ id: string }>(
    sql`insert into customers (organization_id, name) values (${org.id}, 'Jean Petersen') returning id`
  );
  const [job] = await db.execute<{ id: string }>(
    sql`insert into jobs (organization_id, customer_id, name, address)
        values (${org.id}, ${customer.id}, 'Panel upgrade', '14 Elm St') returning id`
  );
  const [otherCustomer] = await db.execute<{ id: string }>(
    sql`insert into customers (organization_id, name) values (${other.id}, 'Not Yours') returning id`
  );
  const [otherJob] = await db.execute<{ id: string }>(
    sql`insert into jobs (organization_id, customer_id, name)
        values (${other.id}, ${otherCustomer.id}, 'Theirs') returning id`
  );

  console.log("");
  console.log("ADDING");
  const order = await createTask(org.id, me.id, {
    ...blank,
    title: "  Order the 200A panel  ",
    jobId: job.id,
    priority: "high",
    dueOn: inDays(2),
  });
  check("a task on a job is added, trimmed", order.title === "Order the 200A panel" && order.job?.id === job.id);
  check("the first task is T-1", order.number === 1, String(order.number));
  check("it reads its job's name and address, not a copy", order.job?.customerName === "Jean Petersen" && order.job.address === "14 Elm St");
  const call = await createTask(org.id, me.id, { ...blank, title: "Renew the van insurance" });
  check("the next is T-2", call.number === 2, String(call.number));
  check("a task with no job is the shop's", call.job === null);
  check("a new one goes to the end of its column", call.position > order.position, `${call.position} vs ${order.position}`);
  const theirs = await createTask(other.id, me.id, { ...blank, title: "Their own" });
  check("another shop counts from 1 on its own", theirs.number === 1, String(theirs.number));

  await refuses("another shop's job can't be used", () => createTask(org.id, me.id, { ...blank, title: "Nope", jobId: otherJob.id }), /No job/);
  await refuses("a stranger can't be given a task", () => createTask(org.id, me.id, { ...blank, title: "Nope", assigneeId: otherCustomer.id }), /Only people on your team/);

  console.log("");
  console.log("MOVING IT");
  const started = await updateTask(org.id, me.id, order.id, { status: "in_progress", position: 5 });
  check("a drag is a status and a place", started.status === "in_progress" && started.position === 5);
  const finished = await updateTask(org.id, me.id, order.id, { status: "done" });
  check("done stamps when", Boolean(finished.completedAt));
  check("a status alone puts it at the end of the new column", finished.position > 0);
  const reopened = await updateTask(org.id, me.id, order.id, { status: "todo" });
  check("reopened, the stamp clears", reopened.completedAt === null);
  const mine = await updateTask(org.id, me.id, call.id, { assigneeId: me.id, dueOn: today, jobId: job.id });
  check("given, dated and put on a job in one change", mine.assigneeId === me.id && mine.dueOn === today && mine.job?.id === job.id);
  const back = await updateTask(org.id, me.id, call.id, { jobId: null });
  check("taken off the job, it's the shop's again", back.job === null);
  await refuses("another shop can't change this one's", () => updateTask(other.id, me.id, order.id, { title: "Hijacked" }), /isn't here/);

  console.log("");
  console.log("READING");
  const everything = await listTasks(org.id);
  check("the shop's list has its tasks and nobody else's", everything.length === 2 && everything.every((task) => task.id !== theirs.id));
  const onJob = await listTasks(org.id, { job: job.id });
  check("narrowed to a job", onJob.length === 1 && onJob[0].id === order.id);
  const myList = await listTasks(org.id, { assignee: me.id });
  check("narrowed to a person", myList.length === 1 && myList[0].id === call.id);
  const nobody = await listTasks(org.id, { assignee: "none" });
  check("nobody's", nobody.length === 1 && nobody[0].id === order.id);
  const found = await listTasks(org.id, { q: "insurance" });
  check("searched by its words", found.length === 1 && found[0].id === call.id);
  const byKey = await listTasks(org.id, { q: "T-1" });
  check("searched by its key", byKey.length === 1 && byKey[0].id === order.id);
  const byCustomer = await listTasks(org.id, { q: "petersen" });
  check("searched by its job's customer", byCustomer.some((task) => task.id === order.id));

  // Long-finished tasks leave the board but stay on their job.
  await updateTask(org.id, me.id, call.id, { status: "done" });
  await db.execute(sql`update tasks set updated_at = now() - interval '30 days' where id = ${call.id}`);
  check("finished long ago, it's off the board", !(await listTasks(org.id)).some((task) => task.id === call.id));
  check("…but on the full record", (await listTasks(org.id, { closed: "all" })).some((task) => task.id === call.id));
  await updateTask(org.id, me.id, call.id, { status: "todo" });

  console.log("");
  console.log("TAGS");
  const [tag] = await db.execute<{ id: string }>(
    sql`insert into tags (organization_id, name, color) values (${org.id}, 'Warranty', 'teal') returning id`
  );
  await db.execute(
    sql`insert into tag_assignments (tag_id, organization_id, task_id) values (${tag.id}, ${org.id}, ${order.id})`
  );
  const tagged = await getTask(org.id, order.id);
  check("a task wears the shop's tags", tagged?.tags.some((t) => t.name === "Warranty") ?? false);
  const byTag = await listTasks(org.id, { tags: tag.id });
  check("filtered by tag", byTag.length === 1 && byTag[0].id === order.id);
  let crossTag = false;
  try {
    await db.execute(
      sql`insert into tag_assignments (tag_id, organization_id, task_id) values (${tag.id}, ${org.id}, ${theirs.id})`
    );
  } catch {
    crossTag = true;
  }
  check("another shop's task can't wear this shop's tag", crossTag);

  console.log("");
  console.log("THE SCHEDULE");
  const booked = await createVisit(org.id, me.id, {
    kind: "work",
    jobId: job.id,
    title: null,
    notes: null,
    allDay: false,
    startsAt: new Date(Date.now() + 26 * 3_600_000).toISOString(),
    endsAt: new Date(Date.now() + 28 * 3_600_000).toISOString(),
    startsOn: null,
    endsOn: null,
    status: "scheduled",
    assignees: [me.id],
    taskId: order.id,
  });
  check("a visit can be booked for a task", booked.visit.task?.id === order.id && booked.visit.task.number === 1);
  const withBooking = await getTask(org.id, order.id);
  check("the task lists the time booked for it", withBooking?.visits.length === 1 && withBooking.visits[0].id === booked.visit.id);
  check("…and its next booking shows on the board", withBooking?.nextBooking?.visitId === booked.visit.id);
  await refuses(
    "another shop's task can't be booked",
    () =>
      createVisit(org.id, me.id, {
        kind: "work",
        jobId: job.id,
        title: null,
        notes: null,
        allDay: true,
        startsAt: null,
        endsAt: null,
        startsOn: today,
        endsOn: today,
        status: "scheduled",
        assignees: [],
        taskId: theirs.id,
      }),
    /No task/
  );
  const window = await listSchedule(org.id, {
    start: new Date(`${inDays(-1)}T00:00:00Z`),
    end: new Date(`${inDays(7)}T00:00:00Z`),
    startDate: inDays(-1),
    endDate: inDays(7),
  });
  check("a task's due date is on the schedule", window.tasks.some((task) => task.id === order.id && task.dueOn === inDays(2)));
  await updateTask(org.id, me.id, call.id, { status: "cancelled", dueOn: inDays(1) });
  const after = await listSchedule(org.id, {
    start: new Date(`${inDays(-1)}T00:00:00Z`),
    end: new Date(`${inDays(7)}T00:00:00Z`),
    startDate: inDays(-1),
    endDate: inDays(7),
  });
  check("a cancelled one isn't", !after.tasks.some((task) => task.id === call.id));
  await updateTask(org.id, me.id, call.id, { status: "todo" });

  console.log("");
  console.log("THE DASHBOARD AND SEARCH");
  const late = await createTask(org.id, me.id, { ...blank, title: "Send the lien waiver", dueOn: inDays(-3) });
  const { thisWeek } = await getDashboard(org.id);
  const row = (id: string) => thisWeek.find((item) => item.key === `task-${id}`);
  check("a task due this week is on it, said as due", row(order.id)?.when.startsWith("Due ") ?? false, row(order.id)?.when);
  check("…with its job's address", row(order.id)?.address === "14 Elm St");
  check("an overdue one says so, and comes first", row(late.id)?.when === "Overdue" && thisWeek[0].key === `task-${late.id}`, JSON.stringify(thisWeek.map((item) => item.key)));
  await updateTask(org.id, me.id, late.id, { status: "done" });
  check("done, it's off the week", !(await getDashboard(org.id)).thisWeek.some((item) => item.key === `task-${late.id}`));
  const hits = await searchKind(org.id, "tasks", "lien");
  check("the header's search finds it", hits.hits.length === 1 && hits.hits[0].href === `/tasks?task=${late.id}`);
  check("…and never another shop's", (await searchKind(org.id, "tasks", "Their own")).hits.length === 0);

  console.log("");
  console.log("TELLING SOMEONE");
  // Composed only — reading, not sending — so nobody is told anything.
  await updateTask(org.id, me.id, order.id, { assigneeId: me.id });
  const notice = await compose({ kind: "task.assigned", organizationId: org.id, taskId: order.id, userId: me.id });
  check("it says what", notice?.title === "New task for you: Order the 200A panel", notice?.title);
  check("…and where", Boolean(notice?.body.startsWith("On Petersen · Panel upgrade.")), notice?.body);
  check("it opens the task", notice?.href === `/tasks?task=${order.id}`);
  check("it tells the person given it and nobody else", notice?.only === true && notice.alsoTo.join() === me.id);
  await updateTask(org.id, me.id, call.id, { assigneeId: null });
  const elsewhere = await compose({ kind: "task.assigned", organizationId: org.id, taskId: call.id, userId: me.id });
  check("handed back, it's no news to them", elsewhere === null);
  await updateTask(org.id, me.id, order.id, { status: "done" });
  check("a finished task is no news", (await compose({ kind: "task.assigned", organizationId: org.id, taskId: order.id, userId: me.id })) === null);

  console.log("");
  console.log("REMOVING");
  await deleteTask(org.id, late.id);
  await refuses("it's gone", () => deleteTask(org.id, late.id), /isn't here/);
  await refuses("another shop can't remove this one's", () => deleteTask(other.id, order.id), /isn't here/);
  await deleteTask(org.id, order.id);
  const [visitLeft] = await db.execute<{ task_id: string | null }>(
    sql`select task_id from visits where id = ${booked.visit.id}`
  );
  check("the visit booked for it stays on the schedule, unlinked", visitLeft !== undefined && visitLeft.task_id === null);
  await db.execute(sql`delete from jobs where id = ${job.id}`);
  check("a job's removal takes its tasks with it", (await listTasks(org.id, { closed: "all" })).every((task) => task.job === null));
} finally {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  for (const id of [org.id, other.id]) {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(organizations).where(eq(organizations.id, id));
      assert.ok(row?.slug.startsWith(SLUG), "Cleanup must target only this script's shops");
      // Everything here cascades from the organization: tasks, jobs, visits,
      // tags, memberships.
      await tx.delete(organizations).where(eq(organizations.id, id));
    });
  }
}

console.log("");
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
process.exit();
