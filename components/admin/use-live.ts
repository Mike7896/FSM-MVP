"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { mergePresenceSnapshot } from "@/lib/admin/live-refresh";
import type { AdminEventLevel } from "@/lib/db/schema/admin";

export type LiveEvent = {
  id: number;
  occurred_at: string;
  kind: string;
  level: AdminEventLevel;
  organization_id: string | null;
  org_name: string | null;
  user_id: string | null;
  title: string;
  amount_cents: number | null;
  test: boolean;
  /** From the team's own accounts — shown, never counted. */
  internal: boolean;
  demo: boolean;
  data: Record<string, unknown>;
};

export type PresenceRow = {
  user_id: string;
  organization_id: string | null;
  area: string;
  device: string | null;
  last_seen: string;
  business?: string | null;
};

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

export function useLive({
  onEvent, onChanged, onSynced, onRecovered, initialPresence,
}: {
  onEvent: (event: LiveEvent) => void;
  onChanged: (table: string) => void;
  onSynced: () => void;
  onRecovered: (events: LiveEvent[]) => void;
  initialPresence: PresenceRow[];
}) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [syncing, setSyncing] = useState(true);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [presence, setPresence] = useState<Record<string, PresenceRow>>(() =>
    Object.fromEntries(initialPresence.map((row) => [row.user_id, row]))
  );
  const recoverRef = useRef<() => void>(() => undefined);
  const handlers = useRef({ onEvent, onChanged, onSynced, onRecovered });
  useEffect(() => {
    handlers.current = { onEvent, onChanged, onSynced, onRecovered };
  }, [onEvent, onChanged, onSynced, onRecovered]);

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    let busy = false;
    let again = false;
    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    let changes = new Map<string, PresenceRow | null>();

    const recover = async () => {
      if (cancelled) return;
      if (busy) { again = true; return; }
      clearTimeout(retryTimer);
      busy = true;
      changes = new Map();
      setSyncing(true);
      request = new AbortController();
      const controller = request;
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch("/api/v1/admin/live", { cache: "no-store", signal: request.signal });
        const body = await response.json() as { data?: { events: LiveEvent[]; presence: PresenceRow[] } };
        if (!response.ok || !body.data) throw new Error("Live feed and presence could not be refreshed.");
        if (cancelled) return;
        setPresence(mergePresenceSnapshot(body.data.presence, changes));
        handlers.current.onRecovered(body.data.events);
        failures = 0;
        setRecoveryError(null);
      } catch (error) {
        if (!cancelled) {
          failures++;
          setRecoveryError(`${error instanceof Error ? error.message : "Live data could not be refreshed."} Recovery will retry automatically.`);
        }
      } finally {
        clearTimeout(timeout);
        busy = false;
        if (!cancelled) {
          setSyncing(false);
          if (again) { again = false; void recover(); }
          else if (failures) retryTimer = setTimeout(() => void recover(), Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
        }
      }
    };
    recoverRef.current = () => void recover();

    void (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (cancelled) return;
        if (data.session) await supabase.realtime.setAuth(data.session.access_token);
        if (cancelled) return;
        channel = supabase.channel("admin:live", { config: { private: true } })
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_events" },
            (payload) => { if (!cancelled) handlers.current.onEvent(payload.new as LiveEvent); })
          .on("postgres_changes", { event: "*", schema: "public", table: "user_presence" }, (payload) => {
            if (cancelled) return;
            const deleted = payload.eventType === "DELETE";
            const row = payload.new as PresenceRow;
            const id = deleted ? (payload.old as Partial<PresenceRow>).user_id : row.user_id;
            if (!id) { void recover(); return; }
            if (busy) changes.set(id, deleted ? null : row);
            setPresence((current) => {
              const next = { ...current };
              if (deleted) delete next[id];
              else next[id] = { ...row, business: current[id]?.organization_id === row.organization_id ? current[id]?.business : undefined };
              return next;
            });
          })
          .on("broadcast", { event: "changed" }, (message) => {
            if (cancelled) return;
            const table = (message.payload as { table?: unknown } | undefined)?.table;
            handlers.current.onChanged(typeof table === "string" ? table : "unknown");
          })
          .subscribe((state) => {
            if (cancelled) return;
            if (state === "SUBSCRIBED") {
              setStatus("live");
              void recover();
              handlers.current.onSynced();
            } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") setStatus("reconnecting");
            else if (state === "CLOSED") setStatus("offline");
          });
      } catch (error) {
        if (!cancelled) {
          setStatus("offline");
          setSyncing(false);
          setRecoveryError(error instanceof Error ? error.message : "Unable to connect to live updates. Reload to retry.");
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      request?.abort();
      recoverRef.current = () => undefined;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  const recover = useCallback(() => recoverRef.current(), []);
  return { status, presence, syncing, recoveryError, recover };
}
