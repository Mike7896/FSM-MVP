/**
 * The schedule, checked against a real database.
 *
 * - **A visit has one shape of time.** Timed visits are instants; all-day ones
 *   are dates; a visit can move between the two and never carries both.
 * - **Work and estimates belong to a job**, and only this shop's.
 * - **A window finds what overlaps it** — a visit that started before the week
 *   and runs into it is on the week.
 * - **Double-booking is said, not refused** — including someone booked over
 *   their day off.
 * - **Inspections come from their permit**, not from a copy.
 *
 * Its writes commit, so it works in a throwaway shop, removed at the end. The
 * only real person involved is the one named in `SCHEDULE_CHECK_EMAIL` (the
 * checker's own account), added to the throwaway shop for the run so there is
 * a team member to double-book, and taken off again with the shop.
 *
 *     SCHEDULE_CHECK_EMAIL=you@example.com npm run schedule:check
 */

import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema/office";
import { compose } from "@/lib/notifications/compose";
import { getDashboard } from "@/lib/queries/dashboard";
import {
  createVisit,
  deleteVisit,
  listSchedule,
  listTeam,
  searchJobs,
  updateVisit,
} from "@/lib/schedule/service";

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

const email = process.env.SCHEDULE_CHECK_EMAIL;
if (!email) {
  console.error("Set SCHEDULE_CHECK_EMAIL to your own sign-in address.");
  process.exit(1);
}

const [me] = await db.execute<{ id: string }>(
  sql`select id from profiles where email = ${email} limit 1`
);
if (!me) {
  console.error(`No profile for ${email}.`);
  process.exit(1);
}

const SLUG = `schedule-check-${Date.now()}`;
const [org] = await db.execute<{ id: string }>(
  sql`insert into organizations (name, slug) values ('Schedule Check', ${SLUG}) returning id`
);
const [other] = await db.execute<{ id: string }>(
  sql`insert into organizations (name, slug) values ('Someone Else', ${`${SLUG}-other`}) returning id`
);

// Fixed instants, so the check means the same thing whenever it runs.
const TZ = "America/Chicago"; // UTC-5 in September
const at = (iso: string) => new Date(iso).toISOString();

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
  console.log("BOOKING");
  const rough = await createVisit(org.id, me.id, {
    kind: "work",
    jobId: job.id,
    title: null,
    notes: null,
    allDay: false,
    startsAt: at("2026-10-06T13:00:00Z"), // 8 am Chicago
    endsAt: at("2026-10-06T17:00:00Z"), // noon
    startsOn: null,
    endsOn: null,
    status: "scheduled",
    assignees: [me.id],
    taskId: null,
    timeZone: TZ,
  });
  check("a timed visit on a job is booked", rough.visit.startsAt === at("2026-10-06T13:00:00Z"));
  check(
    "untitled, it's named for the customer and the job",
    rough.visit.title === "Petersen · Panel upgrade",
    rough.visit.title
  );
  check("the person is on it", rough.visit.assignees.includes(me.id));
  check("nothing else overlaps yet", rough.conflicts.length === 0);

  await refuses(
    "work needs a job",
    () =>
      createVisit(org.id, me.id, {
        kind: "work", jobId: null, title: "Somewhere", notes: null, allDay: false,
        startsAt: at("2026-10-07T13:00:00Z"), endsAt: at("2026-10-07T14:00:00Z"),
        startsOn: null, endsOn: null, status: "scheduled", assignees: [], taskId: null,
      }),
    /job/
  );
  await refuses(
    "another shop's job can't be booked",
    () =>
      createVisit(org.id, me.id, {
        kind: "work", jobId: otherJob.id, title: null, notes: null, allDay: false,
        startsAt: at("2026-10-07T13:00:00Z"), endsAt: at("2026-10-07T14:00:00Z"),
        startsOn: null, endsOn: null, status: "scheduled", assignees: [], taskId: null,
      }),
    /No job/
  );
  await refuses(
    "it has to end after it starts",
    () =>
      createVisit(org.id, me.id, {
        kind: "other", jobId: null, title: "Supply run", notes: null, allDay: false,
        startsAt: at("2026-10-07T14:00:00Z"), endsAt: at("2026-10-07T13:00:00Z"),
        startsOn: null, endsOn: null, status: "scheduled", assignees: [], taskId: null,
      }),
    /end after/
  );

  console.log("");
  console.log("DOUBLE-BOOKING");
  const overlap = await createVisit(org.id, me.id, {
    kind: "estimate", jobId: job.id, title: null, notes: null, allDay: false,
    startsAt: at("2026-10-06T16:00:00Z"), // 11 am, inside the rough-in
    endsAt: at("2026-10-06T17:30:00Z"),
    startsOn: null, endsOn: null, status: "scheduled", assignees: [me.id], taskId: null, timeZone: TZ,
  });
  check("an overlapping booking still goes through", Boolean(overlap.visit.id));
  check(
    "…and names what it overlaps",
    overlap.conflicts.some((c) => c.visitId === rough.visit.id && c.userId === me.id),
    JSON.stringify(overlap.conflicts)
  );
  check("an estimate is titled as one", overlap.visit.title === "Estimate · Petersen · Panel upgrade", overlap.visit.title);

  const dayOff = await createVisit(org.id, me.id, {
    kind: "time_off", jobId: null, title: "Dentist", notes: null, allDay: true,
    startsAt: null, endsAt: null, startsOn: "2026-10-06", endsOn: "2026-10-06",
    status: "scheduled", assignees: [me.id], taskId: null, timeZone: TZ,
  });
  check(
    "a day off over booked work says so",
    dayOff.conflicts.some((c) => c.visitId === rough.visit.id),
    JSON.stringify(dayOff.conflicts)
  );

  const late = await createVisit(org.id, me.id, {
    kind: "other", jobId: null, title: "Supply house", notes: null, allDay: false,
    // 10 pm Chicago on the 5th — the day before the day off, in UTC already the 6th.
    startsAt: at("2026-10-06T03:00:00Z"), endsAt: at("2026-10-06T04:00:00Z"),
    startsOn: null, endsOn: null, status: "scheduled", assignees: [me.id], taskId: null, timeZone: TZ,
  });
  check(
    "the day off is read on their clock, not UTC's",
    !late.conflicts.some((c) => c.visitId === dayOff.visit.id),
    JSON.stringify(late.conflicts)
  );

  console.log("");
  console.log("MOVING IT");
  const moved = await updateVisit(org.id, me.id, rough.visit.id, {
    startsAt: at("2026-10-08T13:00:00Z"),
    endsAt: at("2026-10-08T15:00:00Z"),
    timeZone: TZ,
  });
  check("a drag sends only the times", moved.visit.endsAt === at("2026-10-08T15:00:00Z"));
  check("moved clear, the conflicts go", moved.conflicts.length === 0, JSON.stringify(moved.conflicts));

  const allDay = await updateVisit(org.id, me.id, rough.visit.id, {
    allDay: true, startsOn: "2026-10-08", endsOn: "2026-10-09",
  });
  check(
    "made all-day, it drops its instants",
    allDay.visit.allDay && allDay.visit.startsAt === null && allDay.visit.endsOn === "2026-10-09"
  );
  const unassigned = await updateVisit(org.id, me.id, rough.visit.id, { assignees: [] });
  check("taking everyone off leaves it booked but unstaffed", unassigned.visit.assignees.length === 0);

  await refuses(
    "a stranger can't be put on a visit",
    () => updateVisit(org.id, me.id, rough.visit.id, { assignees: [otherCustomer.id] }),
    /team/
  );

  console.log("");
  console.log("READING A WINDOW");
  await db.execute(
    sql`insert into permits (job_id, jurisdiction) values (${job.id}, 'Chicago')`
  );
  await db.execute(
    sql`insert into inspections (permit_id, job_id, type, result, scheduled_on)
        select id, ${job.id}, 'rough_in', 'scheduled', '2026-10-07' from permits where job_id = ${job.id}`
  );

  const week = await listSchedule(org.id, {
    start: new Date("2026-10-04T05:00:00Z"), // Sun Oct 4, midnight Chicago
    end: new Date("2026-10-11T05:00:00Z"),
    startDate: "2026-10-04",
    endDate: "2026-10-10",
  });
  const ids = week.visits.map((v) => v.id);
  check("the week has every visit in it", [rough.visit.id, overlap.visit.id, dayOff.visit.id, late.visit.id].every((id) => ids.includes(id)), ids.join(","));
  check("…and the inspection its permit booked", week.inspections.length === 1 && week.inspections[0].on === "2026-10-07");

  const nextWeek = await listSchedule(org.id, {
    start: new Date("2026-10-11T05:00:00Z"),
    end: new Date("2026-10-18T05:00:00Z"),
    startDate: "2026-10-11",
    endDate: "2026-10-17",
  });
  check("the week after has none of it", nextWeek.visits.length === 0 && nextWeek.inspections.length === 0);

  const spanning = await createVisit(org.id, me.id, {
    kind: "work", jobId: job.id, title: "Trenching", notes: null, allDay: true,
    startsAt: null, endsAt: null, startsOn: "2026-10-09", endsOn: "2026-10-13",
    status: "scheduled", assignees: [], taskId: null,
  });
  const straddle = await listSchedule(org.id, {
    start: new Date("2026-10-11T05:00:00Z"),
    end: new Date("2026-10-18T05:00:00Z"),
    startDate: "2026-10-11",
    endDate: "2026-10-17",
  });
  check("a visit that started last week and runs into this one is on this one", straddle.visits.some((v) => v.id === spanning.visit.id));

  const theirs = await listSchedule(other.id, {
    start: new Date("2026-10-04T05:00:00Z"), end: new Date("2026-10-18T05:00:00Z"),
    startDate: "2026-10-04", endDate: "2026-10-17",
  });
  check("another shop sees none of it", theirs.visits.length === 0 && theirs.inspections.length === 0);

  console.log("");
  console.log("THE TEAM AND THE PICKER");
  const team = await listTeam(org.id);
  check("the team is the shop's members", team.length === 1 && team[0].userId === me.id);
  const found = await searchJobs(org.id, "petersen");
  check("the picker finds a job by its customer", found.length === 1 && found[0].id === job.id);
  check("the picker never offers another shop's job", !(await searchJobs(org.id, "Theirs")).length);

  console.log("");
  console.log("THE DASHBOARD'S WEEK");
  // The dashboard reads from today, so these are booked from now.
  const soon = new Date(Math.floor((Date.now() + 26 * 3_600_000) / 60_000) * 60_000);
  const later = new Date(soon.getTime() + 3_600_000);
  const today = new Date().toISOString().slice(0, 10);
  const timed = { allDay: false, startsAt: soon.toISOString(), endsAt: later.toISOString(), startsOn: null, endsOn: null };
  const base = { title: null, notes: null, status: "scheduled" as const, assignees: [me.id], taskId: null, timeZone: TZ };
  const upcoming = await createVisit(org.id, me.id, { ...base, ...timed, kind: "work", jobId: job.id });
  const allDayJob = await createVisit(org.id, me.id, {
    ...base, kind: "other", jobId: null, title: "Supply run",
    allDay: true, startsAt: null, endsAt: null, startsOn: today, endsOn: today,
  });
  const off = await createVisit(org.id, me.id, { ...base, ...timed, kind: "time_off", jobId: null });
  const finished = await createVisit(org.id, me.id, { ...base, ...timed, kind: "work", jobId: job.id, status: "done" });
  const { thisWeek: dashboardWeek } = await getDashboard(org.id);
  const row = (id: string) => dashboardWeek.find((item) => item.key === `visit-${id}`);
  check(
    "a visit booked this week is on it, with its start for the browser to print",
    row(upcoming.visit.id)?.at === upcoming.visit.startsAt && row(upcoming.visit.id)?.title === "Petersen · Panel upgrade",
    JSON.stringify(row(upcoming.visit.id))
  );
  check("…with the job's address", row(upcoming.visit.id)?.address === "14 Elm St");
  check("an all-day one is on it with no time", row(allDayJob.visit.id)?.at === null && row(allDayJob.visit.id)?.title === "Supply run");
  check("time off isn't — this list is the work", !row(off.visit.id));
  check("nor one already done", !row(finished.visit.id));

  console.log("");
  console.log("THE BOOKING NOTICE");
  // Composed only — reading, not sending — so nobody is told anything.
  const notice = await compose({ kind: "visit.booked", organizationId: org.id, visitId: upcoming.visit.id, userId: me.id, timeZone: TZ });
  check(
    "it says what and when",
    Boolean(notice?.title.startsWith("You're booked: Petersen · Panel upgrade — ")),
    notice?.title
  );
  check("it opens the visit on the schedule", Boolean(notice?.href.endsWith(`&visit=${upcoming.visit.id}`)), notice?.href);
  check("it tells the person booked and nobody else", notice?.only === true && notice.alsoTo.join() === me.id);
  check(
    "a finished visit is no news",
    (await compose({ kind: "visit.booked", organizationId: org.id, visitId: finished.visit.id, userId: me.id })) === null
  );
  check(
    "another shop can't word this one's",
    (await compose({ kind: "visit.booked", organizationId: other.id, visitId: upcoming.visit.id, userId: me.id })) === null
  );

  for (const visit of [upcoming, allDayJob, off, finished]) await deleteVisit(org.id, visit.visit.id);

  console.log("");
  console.log("REMOVING ONE");
  await deleteVisit(org.id, late.visit.id);
  await refuses("it's gone", () => deleteVisit(org.id, late.visit.id), /isn't on the schedule/);
  await refuses("another shop can't remove this one's", () => deleteVisit(other.id, overlap.visit.id), /isn't on the schedule/);
} finally {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  for (const id of [org.id, other.id]) {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(organizations).where(eq(organizations.id, id));
      assert.ok(row?.slug.startsWith(SLUG), "Cleanup must target only this script's shops");
      // Everything here cascades from the organization: jobs, customers,
      // visits, permits, memberships.
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
