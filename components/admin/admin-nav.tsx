"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ArrowLeft, CreditCard, LifeBuoy, ScrollText, Users } from "lucide-react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin", label: "Live", icon: Activity, exact: true },
  { href: "/admin/accounts", label: "Accounts", icon: Users },
  { href: "/admin/support", label: "Support", icon: LifeBuoy },
  { href: "/admin/billing", label: "Billing", icon: CreditCard },
  { href: "/admin/events", label: "Event log", icon: ScrollText },
];

/**
 * The admin section's own navigation — a different place from the app, and it
 * looks it: its own rail, its own name, and a way back.
 */
export function AdminNav({ email, owner }: { email: string; owner: boolean }) {
  const pathname = usePathname();
  const active = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="bg-card flex shrink-0 flex-col gap-1 border-b p-2 md:sticky md:top-0 md:h-svh md:w-52 md:border-r md:border-b-0 md:p-3">
      <div className="hidden px-2 pb-3 md:block">
        <p className="font-semibold tracking-tight">ServiceClerk</p>
        <p className="text-muted-foreground text-xs">Admin</p>
      </div>
      <nav className="flex gap-1 overflow-x-auto md:flex-col">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active(item.href, item.exact) ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto hidden flex-col gap-2 px-2 pt-4 text-xs md:flex">
        <p className="text-muted-foreground truncate" title={email}>
          {email}
          <span className="block">{owner ? "Owner" : "Admin"}</span>
        </p>
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground flex items-center gap-1.5">
          <ArrowLeft className="size-3.5" />
          Back to the app
        </Link>
      </div>
    </aside>
  );
}
