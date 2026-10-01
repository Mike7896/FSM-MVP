import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson, readQuery } from "@/lib/api/handler";
import { created, ok } from "@/lib/api/response";
import { createTaskSchema, listTasksSchema } from "@/lib/schemas";
import { createTask, listTasks } from "@/lib/tasks";

/**
 * `GET /api/v1/tasks?job&assignee&q&closed` — the shop's tasks, in board order.
 * `POST /api/v1/tasks` — add one.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const filter = readQuery(request, listTasksSchema);
  return ok(await listTasks(organizationId, filter));
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, createTaskSchema);
  const task = await createTask(organizationId, caller.userId, body);
  return created(task, `/api/v1/tasks/${task.id}`);
});
