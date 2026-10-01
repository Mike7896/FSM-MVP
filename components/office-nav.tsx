"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ComingSoon } from "@/components/coming-soon";
import { OFFICE_RAIL_NOTE, officeNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * The Office's section list — wireframe 94 · 56a, a fixed 220px rail beside one
 * panel.
 *
 * **Only the Office has one.** Settings and Account are a single screen each,
 * which is the finding 56b was drawn to prove: everything that used to make
 * Settings feel like a wing turned out to belong to the business, and what
 * remained after the split is genuinely small. Giving those two a rail with two
 * rows on it would dress up as a wing something the design established is not
 * one.
 *
 * **One flat list, no sub-groups.** The old wing needed *My business · How it
 * runs · Account* headings because it held three unlike things. The Office
 * holds one kind of thing, so eight rows need no grouping — the split did the
 * work the headings were doing.
 *
 * The footer is a sentence, not two links. Pointing at the account menu teaches
 * where Settings and Account live; linking to them from here would quietly make
 * the Office their parent, which is the one relationship the split exists to
 * deny.
 */
export function OfficeNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-5">
      <div>
        <p className="mb-4 text-base font-semibold">
          {officeNav.label}
        </p>

        <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
          {officeNav.items.map((item) => {
            // `/office` is the identity page as well as the section root, so it
            // has to match exactly or every page in the section lights it up.
            const active =
              item.href === "/office"
                ? pathname === "/office"
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "hover:bg-muted flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg px-3 py-2.5 text-sm leading-5 transition-colors",
                  active && "bg-muted font-semibold ring-1 ring-border"
                )}
              >
                {item.title}
                {item.reserved ? <ComingSoon className="font-normal" /> : null}
              </Link>
            );
          })}
        </div>
      </div>

      <p className="text-muted-foreground border-t pt-4 text-xs leading-relaxed">
        {OFFICE_RAIL_NOTE}
      </p>
    </nav>
  );
}
