"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiJson } from "@/lib/api/client";
import type {
  JobItemSettings,
  SavedItem,
  SettingValues,
  SettingDef,
  TemplateNode,
} from "@/lib/library";

const ITEMS = ["saved-items"] as const;
const jobKey = (jobId: string | null) => ["job-item-settings", jobId] as const;

/**
 * The Office's Library. Off until there is an Office to read it from — the
 * activation quote is written before one exists.
 */
export function useSavedItems(enabled: boolean) {
  const query = useQuery({
    queryKey: ITEMS,
    queryFn: () => apiJson<SavedItem[]>("/api/v1/saved-items", "GET"),
    enabled,
    staleTime: 60 * 1000,
  });
  return {
    items: query.data ?? [],
    loading: enabled && query.isPending,
    error: query.error ? query.error.message : null,
  };
}

/** This job's own settings, keyed by saved item. Empty until the quote has a job. */
export function useJobItemSettings(jobId: string | null): JobItemSettings {
  const { data } = useQuery({
    queryKey: jobKey(jobId),
    queryFn: () =>
      apiJson<JobItemSettings>(`/api/v1/jobs/${jobId}/item-settings`, "GET"),
    enabled: jobId !== null,
    staleTime: 60 * 1000,
  });
  return data ?? {};
}

export function useLibraryMutations(jobId: string | null) {
  const client = useQueryClient();

  const replaceItem = (item: SavedItem) =>
    client.setQueryData<SavedItem[]>(ITEMS, (current) =>
      current?.map((existing) => (existing.id === item.id ? item : existing))
    );

  const create = useMutation({
    mutationFn: (input: {
      name: string;
      template: TemplateNode;
      settings?: SettingDef[];
      defaults?: SettingValues;
    }) => apiJson<SavedItem>("/api/v1/saved-items", "POST", input),
    onSuccess: (item) =>
      client.setQueryData<SavedItem[]>(ITEMS, (current) => [item, ...(current ?? [])]),
  });

  const update = useMutation({
    mutationFn: ({
      id,
      ...fields
    }: {
      id: string;
      name?: string;
      defaults?: SettingValues;
      template?: TemplateNode;
      settings?: SettingDef[];
      summary?: string | null;
    }) => apiJson<SavedItem>(`/api/v1/saved-items/${id}`, "PATCH", fields),
    onSuccess: replaceItem,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiJson<{ deleted: true }>(`/api/v1/saved-items/${id}`, "DELETE"),
    onSuccess: (_, id) => {
      client.setQueryData<SavedItem[]>(ITEMS, (current) =>
        current?.filter((item) => item.id !== id)
      );
      void client.invalidateQueries({ queryKey: ["job-item-settings"] });
    },
  });

  // Counting a drop is bookkeeping for the sorts. If it fails, nothing the
  // contractor can see is wrong, so it fails quietly.
  const recordUse = useMutation({
    mutationFn: (id: string) =>
      apiJson<{ timesUsed: number; lastUsedAt: string | null }>(
        `/api/v1/saved-items/${id}/used`,
        "POST"
      ),
    onSuccess: (usage, id) =>
      client.setQueryData<SavedItem[]>(ITEMS, (current) =>
        current?.map((item) => (item.id === id ? { ...item, ...usage } : item))
      ),
  });

  const setJobSettings = useMutation({
    mutationFn: (input: { savedItemId: string; values: SettingValues }) =>
      apiJson<JobItemSettings>(`/api/v1/jobs/${jobId}/item-settings`, "PUT", input),
    onSuccess: (settings) => client.setQueryData(jobKey(jobId), settings),
  });

  return { create, update, remove, recordUse, setJobSettings };
}
