/** Shared by the API, the dashboard, and its regression checks. */
export const METRIC_GROUPS = ["activity", "business", "revenue", "engagement", "support", "system"] as const;
export type MetricGroup = (typeof METRIC_GROUPS)[number];

const dependencies: Record<string, readonly MetricGroup[]> = {
  admin_events: ["activity", "business"],
  user_presence: [], // The browser receives these rows directly.
  user_activity_hours: ["engagement"],
  documents: ["business", "activity", "engagement"],
  document_sends: ["business", "activity", "engagement"],
  jobs: ["business", "activity", "engagement"],
  visits: ["business"], tasks: ["business"],
  ledger_entries: ["business", "activity"],
  connected_accounts: ["business"],
  subscriptions: ["revenue", "business"],
  billing_accounts: ["revenue", "business"],
  prices: ["revenue"], products: ["revenue"],
  mrr_changes: ["revenue"], platform_invoices: ["revenue"],
  payment_attempts: ["revenue"], billing_events: ["revenue"],
  platform_usage: ["revenue"], pack_evaluations: ["revenue"],
  support_requests: ["support", "activity"],
  notification_deliveries: ["support"], notifications: ["support"],
  stripe_events: ["support"],
};

// Identity and exclusion-rule changes affect counts throughout the dashboard.
export function groupsForTable(table: string): readonly MetricGroup[] {
  return dependencies[table] ?? METRIC_GROUPS;
}

/** Dirty groups survive writes during a request; each group has one request at a time. */
export function createRefreshQueue(
  refresh: (group: MetricGroup) => Promise<unknown>,
  delay = 600,
) {
  const dirty = new Set<MetricGroup>();
  const running = new Set<MetricGroup>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  function schedule() {
    if (stopped || timer || ![...dirty].some((group) => !running.has(group))) return;
    timer = setTimeout(() => {
      timer = undefined;
      for (const group of dirty) {
        if (running.has(group)) continue;
        dirty.delete(group);
        running.add(group);
        void Promise.resolve().then(() => refresh(group)).catch(() => {
          // Query state exposes the error and handles request retries.
        }).finally(() => {
          running.delete(group);
          schedule();
        });
      }
    }, delay);
  }
  return {
    add(groups: readonly MetricGroup[]) {
      if (stopped) return;
      groups.forEach((group) => dirty.add(group));
      schedule();
    },
    dispose() { stopped = true; clearTimeout(timer); dirty.clear(); },
  };
}

export function mergePresenceSnapshot<T extends { user_id: string }>(
  rows: T[], changes: ReadonlyMap<string, T | null>,
): Record<string, T> {
  const snapshot = Object.fromEntries(rows.map((row) => [row.user_id, row]));
  for (const [id, row] of changes) {
    if (row) snapshot[id] = row;
    else delete snapshot[id];
  }
  return snapshot;
}

/** Keep the visible feed window, including pushes delivered during recovery. */
export function mergeLiveEvents<T extends { id: number; occurred_at: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id - a.id)
    .slice(0, 500);
}
