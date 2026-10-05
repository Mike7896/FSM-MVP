"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import type { AdminEventLevel } from "@/lib/db/schema/admin";

/**
 * The live wire: Supabase Realtime, straight from Postgres, on one private
 * channel — `admin:live`.
 *
 * Three things arrive on it:
 *
 * - **`admin_events` inserts** — every line of the log, the moment it's
 *   written. The feed, the sounds and the banners run on these.
 * - **`user_presence` changes** — a row touched each minute someone has the
 *   app open. Who's online, and who's been in today, this week, are counted
 *   from these in the browser.
 * - **A "changed" signal** — sent by a trigger on every table a number on the
 *   dashboard is counted from (drizzle/0046), naming the table. The numbers
 *   are re-read when one arrives.
 *
 * RLS decides who receives any of it: joining the channel is checked against
 * `realtime.messages`, and each row change against its own table, and only
 * platform admins pass either — nobody else can listen in, even with the
 * public key.
 *
 * `onSynced` fires every time the channel (re)connects. Anything that changed
 * while it was down sent its signal into the void, so that's the moment to
 * re-read.
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
};

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

export function useLive({
  onEvent,
  onChanged,
  onSynced,
  initialPresence,
}: {
  onEvent: (event: LiveEvent) => void;
  /** A table the dashboard counts from was written to. */
  onChanged: (table: string) => void;
  /** The channel is (back) up — re-read whatever might have been missed. */
  onSynced: () => void;
  initialPresence: PresenceRow[];
}) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [presence, setPresence] = useState<Record<string, PresenceRow>>(() =>
    Object.fromEntries(initialPresence.map((row) => [row.user_id, row]))
  );
  // The latest handlers, without re-subscribing every render.
  const handlers = useRef({ onEvent, onChanged, onSynced });
  useEffect(() => {
    handlers.current = { onEvent, onChanged, onSynced };
  }, [onEvent, onChanged, onSynced]);

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);

      channel = supabase
        .channel("admin:live", { config: { private: true } })
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "admin_events" },
          (payload) => handlers.current.onEvent(payload.new as LiveEvent)
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_presence" },
          (payload) => {
            const row = payload.new as PresenceRow | undefined;
            if (row?.user_id) setPresence((current) => ({ ...current, [row.user_id]: row }));
          }
        )
        .on("broadcast", { event: "changed" }, (message) => {
          const table = (message.payload as { table?: unknown } | undefined)?.table;
          handlers.current.onChanged(typeof table === "string" ? table : "unknown");
        })
        .subscribe((state) => {
          if (state === "SUBSCRIBED") {
            setStatus("live");
            handlers.current.onSynced();
          } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") setStatus("reconnecting");
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
