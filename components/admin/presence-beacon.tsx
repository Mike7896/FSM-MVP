"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * "Someone has the app open" — sent about once a minute, and when they move
 * to another part of it, while the tab is in front.
 *
 * Only the area travels: "quotes", "schedule". Never the page or a record — the
 * admin dashboard shows the app being used, not people being watched.
 */
const EVERY = 60_000;

export function PresenceBeacon() {
  const pathname = usePathname();
  const area = pathname.split("/").filter(Boolean)[0] ?? "dashboard";

  useEffect(() => {
    const device = /mobile|android|iphone/i.test(navigator.userAgent) ? "phone" : "computer";
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/v1/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area: area.replace(/[^a-z-]/g, "").slice(0, 24) || "app", device }),
        keepalive: true,
      }).catch(() => undefined);
    };
    ping();
    const timer = setInterval(ping, EVERY);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [area]);

  return null;
}
