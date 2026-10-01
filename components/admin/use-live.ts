"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import type { AdminEventLevel } from "@/lib/db/schema/admin";

/**
 * The live wire: Supabase Realtime, straight from Postgres.
 *
 * Two tables are streamed — `admin_events` (every insert is something that
 * just happened) and `user_presence` (a row touched each minute someone has
 * the app open). RLS decides who receives them: Realtime checks each change
 * against the subscriber's own session, and only platform admins may read
 * either table, so nobody else can listen in even with the public key.
 */

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
  demo: boolean;
  data: Record<string, unknown>;
};

export type PresenceRow = {
  user_id: string;
  organization_id: string | null;
  area: string;
  device: string | null;
  last_seen: string;
};

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

export function useLive({
  onEvent,
  initialPresence,
}: {
  onEvent: (event: LiveEvent) => void;
  initialPresence: PresenceRow[];
}) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [presence, setPresence] = useState<Record<string, PresenceRow>>(() =>
    Object.fromEntries(initialPresence.map((row) => [row.user_id, row]))
  );
  // The latest handler, without re-subscribing every render.
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);

      channel = supabase
        .channel("admin-live")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "admin_events" },
          (payload) => handler.current(payload.new as LiveEvent)
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_presence" },
          (payload) => {
            const row = payload.new as PresenceRow | undefined;
            if (row?.user_id) setPresence((current) => ({ ...current, [row.user_id]: row }));
          }
        )
        .subscribe((state) => {
          if (state === "SUBSCRIBED") setStatus("live");
          else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") setStatus("reconnecting");
          else if (state === "CLOSED") setStatus("offline");
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  return { status, presence };
}
