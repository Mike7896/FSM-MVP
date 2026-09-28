"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { TaskDetail, TaskPriority, TaskStatus, TaskView } from "@/lib/tasks/types";

/**
 * Tasks on the client.
 *
 * **Every change is optimistic.** A card dragged to Done is in Done the moment
 * it's dropped, a status clicked is the new status at once; the write follows,
 * and a refusal puts it back with the reason said. The board, the list, the
 * job's panel and the open task all read the same cache, so a change made in
 * one is already true in the others.
 *
 * The schedule is refreshed after every write too: a due date moved here is a
 * chip moved there.
 */

export type TaskFilter = {
  job?: string;
  assignee?: string;
  q?: string;
  closed?: "recent" | "all";
};

export type TaskChange = Partial<{
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  jobId: string | null;
  dueOn: string | null;
  position: number;
}>;

export type NewTask = TaskChange & { title: string };

const KEY = "tasks";

export function useTasks(filter: TaskFilter, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [KEY, filter],
    queryFn: async (): Promise<TaskView[]> => {
      const params = new URLSearchParams(
        Object.entries(filter).filter((entry): entry is [string, string] => Boolean(entry[1]))
      );
      return send<TaskView[]>(`/api/v1/tasks?${params}`, "GET", undefined, "The tasks didn't load.");
    },
    staleTime: 15_000,
    placeholderData: (previous) => previous,
    enabled: options.enabled ?? true,
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: ["task", id],
    queryFn: () => send<TaskDetail>(`/api/v1/tasks/${id}`, "GET", undefined, "That task didn't load."),
    enabled: Boolean(id),
    staleTime: 5_000,
  });
}

export function useTaskMutations() {
  const client = useQueryClient();

  function patchCached(recipe: (tasks: TaskView[]) => TaskView[]) {
    client.setQueriesData<TaskView[]>({ queryKey: [KEY] }, (tasks) => (tasks ? recipe(tasks) : tasks));
  }

  function refresh(id?: string) {
    void client.invalidateQueries({ queryKey: [KEY] });
    void client.invalidateQueries({ queryKey: ["schedule"] });
    if (id) void client.invalidateQueries({ queryKey: ["task", id] });
  }

  async function snapshot() {
    await client.cancelQueries({ queryKey: [KEY] });
    return client.getQueriesData<TaskView[]>({ queryKey: [KEY] });
  }

  function restore(before: [readonly unknown[], TaskView[] | undefined][] | undefined) {
    for (const [key, data] of before ?? []) client.setQueryData(key, data);
  }

  const create = useMutation({
    mutationFn: (task: NewTask) => send<TaskView>("/api/v1/tasks", "POST", task),
    onSettled: () => refresh(),
  });

  const update = useMutation({
    mutationFn: ({ id, change }: { id: string; change: TaskChange }) =>
      send<TaskView>(`/api/v1/tasks/${id}`, "PATCH", change),
    onMutate: async ({ id, change }) => {
      const before = await snapshot();
      // The job is an object the server names; everything else moves now.
      const rest = Object.fromEntries(
        Object.entries(change).filter(([key]) => key !== "jobId")
      ) as Omit<TaskChange, "jobId">;
      patchCached((tasks) => tasks.map((task) => (task.id === id ? { ...task, ...rest } : task)));
      client.setQueryData<TaskDetail>(["task", id], (task) => (task ? { ...task, ...rest } : task));
      return { before };
    },
    onError: (_error, _variables, context) => restore(context?.before),
    onSettled: (_data, _error, { id }) => refresh(id),
  });

  const remove = useMutation({
    mutationFn: (id: string) => send<void>(`/api/v1/tasks/${id}`, "DELETE"),
    onMutate: async (id) => {
      const before = await snapshot();
      patchCached((tasks) => tasks.filter((task) => task.id !== id));
      return { before };
    },
    onError: (_error, _id, context) => restore(context?.before),
    onSettled: () => refresh(),
  });

  return { create, update, remove };
}

async function send<T>(url: string, method: string, body?: unknown, fallback = "That didn't save. Try again."): Promise<T> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const result = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string };
  } | null;
  if (!response.ok) throw new Error(result?.error?.message ?? fallback);
  return result!.data as T;
}

/**
 * A place between two neighbours in a column — the midpoint, so a drop writes
 * one row. At either end, a step past the last one.
 */
export function between(before: number | undefined, after: number | undefined) {
  if (before === undefined && after === undefined) return 1024;
  if (before === undefined) return after! - 1024;
  if (after === undefined) return before + 1024;
  return (before + after) / 2;
}
