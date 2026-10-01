"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { addDays, toISODate, viewDays, type ScheduleView } from "@/lib/schedule/dates";
import type {
  ScheduleConflict,
  ScheduleRange,
  ScheduleVisit,
} from "@/lib/schedule/types";

/**
 * The schedule's data, on the client.
 *
 * **One window at a time**, keyed by its edges, so flipping back to last week
 * is instant and the week after is fetched only when it's asked for.
 *
 * **Moves are optimistic.** A block dragged to Thursday lands on Thursday the
 * moment it's dropped; the write follows, and if it's refused the block goes
 * back where it was with the reason said. Waiting on a round trip to see your
 * own drag land is how a calendar starts feeling broken.
 */

export type Window = {
  days: Date[];
  start: Date;
  end: Date;
  startDate: string;
  endDate: string;
};

export function windowFor(view: ScheduleView, anchor: Date): Window {
  const days = viewDays(view, anchor);
  const start = days[0];
  const end = addDays(days[days.length - 1], 1);
  return {
    days,
    start,
    end,
    startDate: toISODate(start),
    endDate: toISODate(days[days.length - 1]),
  };
}

const KEY = "schedule";

export function useScheduleWindow(window: Window) {
  return useQuery({
    queryKey: [KEY, window.startDate, window.endDate],
    queryFn: async (): Promise<ScheduleRange> => {
      const params = new URLSearchParams({
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        startDate: window.startDate,
        endDate: window.endDate,
      });
      const response = await fetch(`/api/v1/schedule?${params}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as {
        data?: ScheduleRange;
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.data) {
        throw new Error(body?.error?.message ?? "The schedule didn't load.");
      }
      return body.data;
    },
    // A week you just left is still right a minute later.
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

export type VisitDraft = {
  kind: ScheduleVisit["kind"];
  jobId: string | null;
  title: string | null;
  notes: string | null;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startsOn: string | null;
  endsOn: string | null;
  status?: ScheduleVisit["status"];
  assignees: string[];
  /** The task it's booked for. Left out, a change leaves it as it was. */
  taskId?: string | null;
};

type Saved = { visit: ScheduleVisit; conflicts: ScheduleConflict[] };

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const result = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(result?.error?.message ?? "That didn't save. Try again.");
  }
  return result!.data as T;
}

export function useVisitMutations() {
  const client = useQueryClient();

  /** Every cached window, patched the same way. */
  function patchCached(recipe: (visits: ScheduleVisit[]) => ScheduleVisit[]) {
    client.setQueriesData<ScheduleRange>({ queryKey: [KEY] }, (range) =>
      range ? { ...range, visits: recipe(range.visits) } : range
    );
  }

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["tasks"] });
    void client.invalidateQueries({ queryKey: ["task"] });
    return client.invalidateQueries({ queryKey: [KEY] });
  };

  const create = useMutation({
    mutationFn: (draft: VisitDraft) =>
      send<Saved>("/api/v1/schedule/visits", "POST", { ...draft, timeZone: zone() }),
    onSettled: refresh,
  });

  const update = useMutation({
    mutationFn: ({ id, change }: { id: string; change: Partial<VisitDraft> }) =>
      send<Saved>(`/api/v1/schedule/visits/${id}`, "PATCH", { ...change, timeZone: zone() }),
    onMutate: async ({ id, change }) => {
      await client.cancelQueries({ queryKey: [KEY] });
      const before = client.getQueriesData<ScheduleRange>({ queryKey: [KEY] });
      // Only what the grid draws moves ahead of the server — the time, the
      // status, who's on it. The rest (the job, the title) waits for the
      // answer, which knows how to name it.
      patchCached((visits) =>
        visits.map((visit) =>
          visit.id === id ? { ...visit, ...optimistic(change) } : visit
        )
      );
      return { before };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.before ?? []) client.setQueryData(key, data);
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => send<void>(`/api/v1/schedule/visits/${id}`, "DELETE"),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: [KEY] });
      const before = client.getQueriesData<ScheduleRange>({ queryKey: [KEY] });
      patchCached((visits) => visits.filter((visit) => visit.id !== id));
      return { before };
    },
    onError: (_error, _id, context) => {
      for (const [key, data] of context?.before ?? []) client.setQueryData(key, data);
    },
    onSettled: refresh,
  });

  return { create, update, remove };
}

function optimistic(change: Partial<VisitDraft>): Partial<ScheduleVisit> {
  const keys = ["allDay", "startsAt", "endsAt", "startsOn", "endsOn", "status", "assignees"] as const;
  return Object.fromEntries(
    keys.filter((key) => change[key] !== undefined).map((key) => [key, change[key]])
  ) as Partial<ScheduleVisit>;
}
