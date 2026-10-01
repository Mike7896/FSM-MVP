"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

import { GlobalSearch } from "@/components/search/global-search";
import { ModeToggle } from "@/components/mode-toggle";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { NewMenu } from "@/components/new-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

/**
 * Segments whose label should not be title-cased from the URL.
 *
 * These are the same labels the navigation uses, and that is IA §2's rule
 * rather than tidiness: **the route segment matches the label**, and where a
 * route and a label diverge, one of them is wrong. A breadcrumb that renames a
 * destination on the way to it is the cheapest possible way to break that.
 */
const LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  quotes: "Quotes",
  jobs: "Jobs",
  schedule: "Schedule",
  tasks: "Tasks",
  help: "Help",
  contact: "Contact us",
  customers: "Customers",
  invoices: "Invoices",
  "price-book": "Price Book",
  "release-notes": "Release Notes",
  view: "View",
  contracts: "Contracts",
  upgrade: "Upgrade",
  new: "New",
  capture: "Capture",
  complete: "Phase complete",
  money: "Job money",
  receipt: "Receipt",
  "change-orders": "Change orders",
  contract: "Contract",
  permits: "Permits",
  "info-request": "Info request",
  checkout: "Checkout",
  onboarding: "Get set up",

  // The three occasional-use destinations — IA §5.3. Split by whose thing it
  // is: the business's, the app's, and the person's.
  office: "The Office",
  branding: "Document branding",
  defaults: "Defaults",
  licenses: "Licenses",
  automations: "Automations",
  packs: "Trade packs",
  connections: "Connections",
  data: "Data",

  settings: "Settings",
  appearance: "Appearance",
  notifications: "Notifications",

  account: "Account",
  billing: "Billing",
  plan: "Change plan",
  cancel: "Cancel",
};

/** One of a list, for a record's id in the path — "/jobs/<id>" reads "Job". */
const ONE_OF: Record<string, string> = {
  jobs: "Job",
  quotes: "Quote",
  customers: "Customer",
  invoices: "Invoice",
  contracts: "Contract",
  permits: "Permit",
  "change-orders": "Change order",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function labelFor(segment: string, parent?: string) {
  if (LABELS[segment]) return LABELS[segment];
  // A record's id is never a label anyone can read.
  if (UUID.test(segment)) return (parent && ONE_OF[parent]) || "Details";
  // Ids like `j-henderson` or `q-1042` read better as-is than title-cased.
  if (/^[a-z]-/.test(segment) || /^\d/.test(segment)) return segment;
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
}

export function AppHeader() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  return (
    <header
      data-print="hide"
      // `relative` so the search can centre on the header itself rather than
      // on the space the breadcrumb and the actions happen to leave.
      className="bg-background relative sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4"
    >
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 !h-4" />

      <Breadcrumb className="min-w-0 flex-1 md:max-w-[calc(50%-18rem)]">
        {/* One line, cut short with an ellipsis — on a phone the actions
            leave the title only a few letters' room. */}
        <BreadcrumbList className="flex-nowrap">
          {segments.map((segment, i) => {
            const href = `/${segments.slice(0, i + 1).join("/")}`;
            const isLast = i === segments.length - 1;
            return (
              <Fragment key={href}>
                <BreadcrumbItem className={i === 0 ? "min-w-0" : "hidden min-w-0 md:inline-flex"}>
                  {isLast ? (
                    <BreadcrumbPage className="truncate">{labelFor(segment, segments[i - 1])}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={href} className="truncate">{labelFor(segment, segments[i - 1])}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {isLast ? null : (
                  <BreadcrumbSeparator className="hidden md:block" />
                )}
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>

      {/* One box for every object, centred — the search is the header's
          middle, not something squeezed between two other things. */}
      <GlobalSearch />

      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <ModeToggle />
        <NewMenu />
      </div>
    </header>
  );
}
