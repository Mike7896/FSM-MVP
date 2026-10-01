"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import { useNotifications } from "@/components/notifications/notifications-provider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { InboxItem } from "@/lib/notifications/catalog";
import { cn } from "@/lib/utils";

/**
 * The bell — every notification, newest first, in the Office they're in.
 *
 * **A relay, not a second dashboard** (IA §3.4). Each row is a state and a
 * way to the screen that changes it; opening one goes there and marks it read.
 * Nothing here can be acted on in place, because the screen it opens is where
 * the action already lives.
 *
 * The count is the unread ones, capped at "9+" — past nine, the exact number
 * stops changing what anyone does next.
 */
export function NotificationBell() {
  const { items, unread, loaded, open, markAllRead } = useNotifications();
  const [shown, setShown] = useState(false);

  return (
    <Popover open={shown} onOpenChange={setShown}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell />
          {unread > 0 ? (
            <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground -mr-2 h-7 px-2 text-xs"
              onClick={markAllRead}
            >
              Mark all read
            </Button>
          ) : null}
        </div>

        {!loaded ? (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">
            Checking…
          </p>
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium">Nothing yet</p>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Quote opens and approvals, payments, overdue invoices and
              inspection results land here.
            </p>
          </div>
        ) : (
          <ul className="max-h-[min(28rem,70vh)] divide-y overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <Row
                  item={item}
                  onOpen={() => {
                    setShown(false);
                    open(item);
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="border-t px-4 py-2.5">
          <Link
            href="/settings#notifications"
            onClick={() => setShown(false)}
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
          >
            Choose what reaches you, and how
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({ item, onOpen }: { item: InboxItem; onOpen: () => void }) {
  const unread = item.readAt === null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="hover:bg-muted/60 flex w-full gap-3 px-4 py-3 text-left transition-colors"
    >
      <span
        aria-hidden
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          unread ? "bg-primary" : "bg-transparent"
        )}
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm leading-snug",
            unread ? "font-medium" : "text-muted-foreground"
          )}
        >
          {item.title}
        </span>
        <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-xs leading-relaxed">
          {item.body}
        </span>
      </span>
      <span
        className="text-muted-foreground shrink-0 text-[11px] tabular-nums"
        suppressHydrationWarning
      >
        {ago(item.createdAt)}
      </span>
    </button>
  );
}

/** "now", "12m", "3h", "2d", then the date. */
function ago(iso: string) {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
