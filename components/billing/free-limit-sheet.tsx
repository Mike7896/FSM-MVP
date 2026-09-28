"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { LocalTime } from "@/components/local-time";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { FREE_LIMIT_EVENT, type FreeLimitDetail } from "@/lib/membership/limit-event";

/**
 * Screen 29 · the upgrade prompt · Flow 10 · Billing §3.1.
 *
 * **A sheet at the route it interrupts**, with the draft visible behind it —
 * the limit fires at the moment the product is proving itself, often in a
 * customer's kitchen, so it offers the way forward without taking them
 * anywhere they didn't ask to go. The draft is already saved and says so;
 * "See plans" comes back to it.
 */
export function FreeLimitSheet() {
  const pathname = usePathname();
  const [detail, setDetail] = useState<FreeLimitDetail | null>(null);

  useEffect(() => {
    const open = (event: Event) => setDetail((event as CustomEvent<FreeLimitDetail>).detail);
    window.addEventListener(FREE_LIMIT_EVENT, open);
    return () => window.removeEventListener(FREE_LIMIT_EVENT, open);
  }, []);

  if (!detail) return null;

  return (
    <ResponsiveDialog open onOpenChange={(open) => (open ? null : setDetail(null))}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-md">
        <ResponsiveDialogHeader
          title={`You've used this month's ${detail.limit} free jobs`}
          description="Your draft is saved, exactly as you left it."
        />
        <ResponsiveDialogBody>
          <p className="text-sm leading-relaxed">
            Any paid plan sends it now, with no limit on new jobs. Or it can go out when your free jobs reset{" "}
            <LocalTime iso={detail.resetsAt} />.
          </p>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Jobs you&apos;ve already started aren&apos;t affected — their invoices, deposits and change orders still go.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setDetail(null)}>
              Not now
            </Button>
            <Button asChild>
              <Link href={`/upgrade?next=${encodeURIComponent(pathname)}`}>See plans</Link>
            </Button>
          </div>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
