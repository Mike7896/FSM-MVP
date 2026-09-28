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
import { toast } from "sonner";

import type { InboxItem } from "@/lib/notifications/catalog";

/**
 * The app's side of notifications — one poll, two faces.
 *
 * **The bell** lists them; **the pop-ups** announce the ones that arrive while
 * someone is working. Both read this one state, so a pop-up opened and a bell
 * row opened are the same notification marked read once.
 *
 * **Polled, not pushed.** Every half-minute while the tab is visible, and the
 * moment it becomes visible again. A realtime socket would be quicker by a few
 * seconds and would put a second, stateful connection behind every signed-in
 * tab; for news like "the Patels opened the quote", thirty seconds is on time.
 *
 * **The first read never pops anything up.** What was already waiting shows
 * as the bell's count; a pop-up is only for what arrives while they're here —
 * opening the app to eleven toasts would be the product shouting.
 */

const POLL_MS = 30_000;
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

  useEffect(() => {
    const now = () => {
      if (document.visibilityState === "visible") void poll();
    };

    // Deferred a tick, so the first read lands after the page has painted
    // rather than competing with it.
    const first = setTimeout(now, 0);
    const timer = setInterval(now, POLL_MS);
    document.addEventListener("visibilitychange", now);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", now);
    };
  }, [poll]);

  return (
    <Context.Provider
      value={{ items, unread, loaded, open, markAllRead: () => markRead("all") }}
    >
      {children}
    </Context.Provider>
  );
}
