"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";

import type { InboxItem } from "@/lib/notifications/catalog";
import { createClient } from "@/lib/supabase/client";

/**
 * The app's side of notifications — one read, two faces.
 *
 * **The bell** lists them; **the pop-ups** announce the ones that arrive while
 * someone is working. Both read this one state, so a pop-up opened and a bell
 * row opened are the same notification marked read once.
 *
 * **Pushed, not polled.** Supabase Realtime tells this tab the moment a row is
 * written to, or marked read in, this person's own notifications — RLS decides
 * who hears what, the same as a select. The push only says *something
 * changed*; the list itself is re-read from the API, so there is one shape and
 * one set of rules for what shows. A slow check stays underneath as a safety
 * net: every five minutes while the socket is up, every half-minute while it
 * isn't, and whenever the tab comes back into view.
 *
 * **The first read never pops anything up.** What was already waiting shows
 * as the bell's count; a pop-up is only for what arrives while they're here —
 * opening the app to eleven toasts would be the product shouting.
 */

/** Safety-net checks: slow while Realtime is connected, quicker while it isn't. */
const LIVE_CHECK_MS = 5 * 60_000;
const FALLBACK_CHECK_MS = 30_000;
/** More than this at once is one pop-up pointing at the bell, not a stack. */
const MAX_POPUPS = 3;

type NotificationsState = {
  items: InboxItem[];
  unread: number;
  loaded: boolean;
  open: (item: InboxItem) => void;
  markAllRead: () => void;
};

const Context = createContext<NotificationsState | null>(null);

export function useNotifications(): NotificationsState {
  const state = useContext(Context);
  if (!state) {
    throw new Error("useNotifications needs a NotificationsProvider above it.");
  }
  return state;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // What's already been seen, so a poll can tell what's new. A ref, not
  // state: it only decides, it never draws.
  const known = useRef<Set<string> | null>(null);

  const markRead = useCallback((ids: string[] | "all") => {
    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) =>
        item.readAt || (ids !== "all" && !ids.includes(item.id))
          ? item
          : { ...item, readAt: now }
      )
    );
    setUnread((count) => (ids === "all" ? 0 : Math.max(0, count - ids.length)));

    void fetch("/api/v1/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids === "all" ? { all: true } : { ids }),
    }).catch(() => undefined);
  }, []);

  const open = useCallback(
    (item: InboxItem) => {
      if (!item.readAt) markRead([item.id]);
      router.push(item.href);
    },
    [markRead, router]
  );

  const poll = useCallback(async () => {
    const response = await fetch("/api/v1/notifications", {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) return;

    const body = (await response.json().catch(() => null)) as {
      data?: { items: InboxItem[]; unread: number; toasts: boolean };
    } | null;
    const data = body?.data;
    if (!data) return;

    const seen = known.current;
    const arrived = seen
      ? data.items.filter((item) => !seen.has(item.id) && !item.readAt)
      : [];
    known.current = new Set(data.items.map((item) => item.id));

    setItems(data.items);
    setUnread(data.unread);
    setLoaded(true);

    if (!data.toasts || arrived.length === 0) return;

    // Oldest first, so the newest ends up on top of the stack.
    const shown = arrived.slice(0, MAX_POPUPS).reverse();
    for (const item of shown) {
      toast(item.title, {
        id: item.id,
        description: item.body,
        duration: 10_000,
        action: { label: "Open", onClick: () => open(item) },
      });
    }
    if (arrived.length > MAX_POPUPS) {
      toast(`${arrived.length - MAX_POPUPS} more — they're in the bell`, {
        duration: 10_000,
      });
    }
  }, [open]);

  // Realtime: the database says when this person's notifications change.
  const [live, setLive] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (cancelled || !userId) return;
      await supabase.realtime.setAuth(data.session!.access_token);

      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          () => {
            if (document.visibilityState === "visible") void poll();
          }
        )
        .subscribe((state) => {
          if (state === "SUBSCRIBED") setLive(true);
          else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") setLive(false);
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [poll]);

  useEffect(() => {
    const now = () => {
      if (document.visibilityState === "visible") void poll();
    };

    // Deferred a tick, so the first read lands after the page has painted
    // rather than competing with it.
    const first = setTimeout(now, 0);
    const timer = setInterval(now, live ? LIVE_CHECK_MS : FALLBACK_CHECK_MS);
    document.addEventListener("visibilitychange", now);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", now);
    };
  }, [poll, live]);

  return (
    <Context.Provider
      value={{ items, unread, loaded, open, markAllRead: () => markRead("all") }}
    >
      {children}
    </Context.Provider>
  );
}
