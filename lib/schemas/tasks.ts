import { z } from "zod";

import { tagFilterShape } from "@/lib/tags";

/**
 * The tasks API. A task is a title and, optionally, everything else — who,
 * which job, when it's due, how much it matters.
 */

const status = z.enum(["backlog", "todo", "in_progress", "done", "cancelled"]);
const priority = z.enum(["none", "urgent", "high", "medium", "low"]);

const fields = {
  title: z
    .string()
    .trim()
    .min(1, "Give the task a title.")
    .max(200, "Keep the title under 200 characters — the details go below it."),
  description: z.string().trim().max(10_000).nullable(),
  status,
  priority,
  assigneeId: z.uuid().nullable(),
  jobId: z.uuid().nullable(),
  dueOn: z.iso.date().nullable(),
  /** Its place in its column, from a drag. Left out, it goes to the end. */
  position: z.number().finite(),
};

export const createTaskSchema = z.object({
  title: fields.title,
  description: fields.description.optional().default(null),
  status: status.optional().default("todo"),
  priority: priority.optional().default("none"),
  assigneeId: fields.assigneeId.optional().default(null),
  jobId: fields.jobId.optional().default(null),
  dueOn: fields.dueOn.optional().default(null),
  position: fields.position.optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Any subset — a drag sends a status and a place, a rename only the title. */
export const updateTaskSchema = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one thing to change.",
  });

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * `GET /api/v1/tasks` — the shop's tasks, narrowed.
 *
 * Finished tasks are old news after a while: by default only those closed in
 * the last few weeks come back, unless a job is asked for — a job's own list
 * is its whole record.
 */
export const listTasksSchema = z.object({
  job: z.uuid().optional(),
  assignee: z.union([z.uuid(), z.literal("none")]).optional(),
  q: z.string().trim().max(100).optional(),
  closed: z.enum(["recent", "all"]).optional(),
  ...tagFilterShape,
});

export type ListTasksInput = z.infer<typeof listTasksSchema>;
