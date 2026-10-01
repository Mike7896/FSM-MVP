import { z } from "zod";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, noContent, ok } from "@/lib/api/response";
import { updateTaskSchema } from "@/lib/schemas";
import { deleteTask, getTask, updateTask } from "@/lib/tasks";

/** `/api/v1/tasks/[id]` — one task: read it, change it, remove it. */

/** A link with a mangled id is a task that isn't here, not a server error. */
function taskId(id: string) {
  if (!z.uuid().safeParse(id).success) {
    throw new ApiError("not_found", "That task isn't here any more.");
  }
  return id;
}

export const GET = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const task = await getTask(organizationId, taskId(id));
  if (!task) throw new ApiError("not_found", "That task isn't here any more.");
  return ok(task);
});

/** A drag sends a status and a place; the panel sends what it changed. */
export const PATCH = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const change = await readJson(request, updateTaskSchema);
  return ok(await updateTask(organizationId, caller.userId, taskId(id), change));
});

export const DELETE = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  await deleteTask(organizationId, taskId(id));
  return noContent();
});
