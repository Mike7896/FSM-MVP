import { z } from "zod";

/**
 * The schedule's API — visits booked against jobs, and time off.
 *
 * A visit has one of two shapes of time and never both: instants for a timed
 * visit, calendar dates for an all-day one. The shape is checked here so a
 * malformed visit is a sentence about what's wrong rather than the database's
 * check constraint.
 */

const kind = z.enum(["work", "estimate", "time_off", "other"]);
const status = z.enum(["scheduled", "done", "cancelled"]);
const instant = z.iso.datetime({ offset: true });
const day = z.iso.date();

/** Anything the browser's clock knows about. */
const timeZone = z
  .string()
  .max(64)
  .refine(
    (zone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "That time zone isn't one we recognise." }
  );

const fields = {
  kind,
  jobId: z.uuid().nullable(),
  title: z.string().trim().max(120).nullable(),
  notes: z.string().trim().max(2000).nullable(),
  allDay: z.boolean(),
  startsAt: instant.nullable(),
  endsAt: instant.nullable(),
  startsOn: day.nullable(),
  endsOn: day.nullable(),
  status,
  assignees: z.array(z.uuid()).max(25),
  /** The task this time is booked to get done. */
  taskId: z.uuid().nullable(),
  /**
   * The browser's zone. Only used to compare a timed visit with somebody's
   * all-day time off, and to word the notification — the times themselves are
   * instants and need no zone.
   */
  timeZone: timeZone.optional(),
};

export const createVisitSchema = z.object({
  ...fields,
  jobId: fields.jobId.optional().default(null),
  title: fields.title.optional().default(null),
  notes: fields.notes.optional().default(null),
  allDay: fields.allDay.optional().default(false),
  startsAt: fields.startsAt.optional().default(null),
  endsAt: fields.endsAt.optional().default(null),
  startsOn: fields.startsOn.optional().default(null),
  endsOn: fields.endsOn.optional().default(null),
  status: fields.status.optional().default("scheduled"),
  assignees: fields.assignees.optional().default([]),
  taskId: fields.taskId.optional().default(null),
});

export type CreateVisitInput = z.infer<typeof createVisitSchema>;

/** Any subset — a drag sends only the times, a rename only the title. */
export const updateVisitSchema = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).some((key) => key !== "timeZone"), {
    message: "Send at least one thing to change.",
  });

export type UpdateVisitInput = z.infer<typeof updateVisitSchema>;

/**
 * `GET /api/v1/schedule` — what's on in a window.
 *
 * Two edges each, because the view has both kinds of time on it: the instants
 * the window starts and ends at, for timed visits, and the dates it covers,
 * for all-day ones and inspections. The browser works out both from its own
 * clock.
 */
export const listScheduleSchema = z
  .object({
    start: instant,
    end: instant,
    startDate: day,
    endDate: day,
  })
  .refine((range) => Date.parse(range.end) > Date.parse(range.start), {
    message: "The window has to end after it starts.",
  })
  .refine(
    (range) => Date.parse(range.end) - Date.parse(range.start) <= 62 * 86_400_000,
    { message: "Ask for two months or less at a time." }
  );

/** `GET /api/v1/schedule/jobs` — the job picker's search. */
export const scheduleJobSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
});
