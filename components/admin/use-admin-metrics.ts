"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { AdminMetricParts, AdminMetrics } from "@/lib/admin/metrics";
import { createRefreshQueue, groupsForTable, METRIC_GROUPS, type MetricGroup } from "@/lib/admin/live-refresh";

export function useAdminMetrics() {
  const client = useQueryClient();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const queries = useQueries({ queries: METRIC_GROUPS.map((group) => ({
    queryKey: ["admin-metrics", timeZone, group],
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Partial<AdminMetricParts>> => {
      const response = await fetch(`/api/v1/admin/metrics?${new URLSearchParams({ tz: timeZone, group })}`, { cache: "no-store", signal });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? `Unable to refresh ${group}.`);
      return body.data;
    },
  })) });

  const queue = useRef<ReturnType<typeof createRefreshQueue> | null>(null);
  useEffect(() => {
    let disposed = false;
    const refreshQueue = createRefreshQueue(async (group) => {
      const filter = { queryKey: ["admin-metrics", timeZone, group], exact: true };
      // If the initial read (or network reconnect read) is already running,
      // wait for it, then read again: that read may predate this notification.
      const alreadyFetching = client.isFetching(filter) > 0;
      await client.refetchQueries(filter, { cancelRefetch: false });
      if (alreadyFetching && !disposed) await client.refetchQueries(filter, { cancelRefetch: false });
    });
    queue.current = refreshQueue;
    return () => { disposed = true; refreshQueue.dispose(); queue.current = null; };
  }, [client, timeZone]);
  const refresh = useCallback((groups: readonly MetricGroup[] = METRIC_GROUPS) => queue.current?.add(groups), []);
  const onChanged = useCallback((table: string) => refresh(groupsForTable(table)), [refresh]);

  const complete = queries.every((query) => query.data !== undefined);
  const parts = complete ? Object.assign({}, ...queries.map((query) => query.data)) as AdminMetricParts : undefined;
  const dataUpdatedAt = Math.min(...queries.map((query) => query.dataUpdatedAt));
  const data: AdminMetrics | undefined = parts ? {
    ...parts, founder: { ...parts.founderRevenue, usage: parts.founderUsage },
    generatedAt: new Date(dataUpdatedAt).toISOString(), timeZone,
  } : undefined;
  const failed = queries.flatMap((query, index) => query.isError ? [METRIC_GROUPS[index]] : []);
  return {
    data, dataUpdatedAt, failed, timeZone,
    isFetching: queries.some((query) => query.isFetching),
    isError: failed.length > 0,
    error: queries.find((query) => query.error)?.error,
    refresh, onChanged,
  };
}
