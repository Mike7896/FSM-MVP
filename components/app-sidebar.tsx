"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, LifeBuoy, LogOut, Megaphone, ShieldCheck } from "lucide-react";

import { BrandIcon, Wordmark } from "@/components/brand";
import { useSignOut } from "@/hooks/use-sign-out";
import { ReleaseNotesDot } from "@/components/release-notes/seen";
import {
  RELEASE_NOTES_ROUTE,
  RELEASE_NOTES_TITLE,
} from "@/lib/release-notes/entries";
import { accountNav, primaryNav, settingsNav } from "@/lib/nav";
import { ComingSoon } from "@/components/coming-soon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

/**
 * Desktop web sidebar — surface class B.
 *
 * The item set is fixed by Information Architecture §3.1 and is not a matter of
 * taste: a navigation destination must be an object you can list instances of.
 *
 * **The Office is in the nav; Settings and Account are not.** All three are
 * occasional-use, but only one of them is somewhere a contractor *returns to in
 * order to work* — the license for a township, the pack their trade runs on,
 * the deposit every quote starts from. Settings and Account are visited rarely
 * and on purpose, which is exactly what an account menu is for (IA §3.1).
 */
export function AppSidebar({
  businessName,
  personName,
  userEmail,
  monthlyTotal,
  isAdmin,
}: {
  businessName: string;
  /** The contractor's own name, where we have one. */
  personName: string | null;
  userEmail: string;
  /** What they pay us, shown on the Account row. Null when nothing is due. */
  monthlyTotal: string | null;
  /** Platform admin access, resolved by the server. */
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const { signOut, pending: signingOut } = useSignOut();

  function isActive(href: string) {
    // The Office collapses to one nav entry, so any route inside it lights up.
    if (href === "/office") return pathname.startsWith("/office");
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    // Chrome, not content: none of it reaches a printed page.
    <Sidebar collapsible="icon" data-print="hide">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="gap-3 px-2.5">
              <Link href="/dashboard">
                {/* Collapsed to the rail there is room for the icon alone —
                    nine letters can't hold a 32px square. Open, the wordmark
                    at nav size, with the business's name under it. */}
                <BrandIcon className="hidden group-data-[collapsible=icon]:block" />
                <div className="grid flex-1 gap-1.5 text-left leading-tight group-data-[collapsible=icon]:hidden">
                  <Wordmark />
                  <span className="truncate font-semibold">
                    {businessName}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-2">
        <SidebarGroup className="px-2 py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {primaryNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.href)}
                    tooltip={item.title}
                    className="h-9 gap-3 px-2.5"
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                      {item.reserved ? (
                        <ComingSoon
                          className="ml-auto group-data-[collapsible=icon]:hidden"
                        />
                      ) : null}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* **Not in the object nav above, deliberately.** Every entry up there
            is one of the app's nouns (plus the Office, which a contractor
            returns to). Release Notes is neither — it is the app talking
            about itself — so it sits apart, at the foot, with a dot when something
            has landed since this browser last looked. */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {isAdmin ? (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive("/admin")}
                    tooltip="Admin"
                    className="h-9 gap-3 px-2.5"
                  >
                    <Link href="/admin">
                      <ShieldCheck />
                      <span>Admin</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(RELEASE_NOTES_ROUTE)}
                  tooltip={RELEASE_NOTES_TITLE}
                  className="h-9 gap-3 px-2.5"
                >
                  <Link href={RELEASE_NOTES_ROUTE}>
                    <Megaphone />
                    <span>{RELEASE_NOTES_TITLE}</span>
                    <ReleaseNotesDot />
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {/* The way to a person, from every page. It carries the page it
                  was opened from, so a problem report says where without
                  asking. */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive("/help")}
                  tooltip="Help"
                  className="h-9 gap-3 px-2.5"
                >
                  <Link
                    href={
                      pathname.startsWith("/help")
                        ? "/help"
                        : `/help?${new URLSearchParams({ from: pathname })}`
                    }
                  >
                    <LifeBuoy />
                    <span>Help</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="gap-3 px-2.5">
                  <div className="bg-background flex size-8 items-center justify-center rounded-lg text-xs font-semibold">
                    {initials(personName, userEmail)}
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    {/* The person's name, a few pixels under the business's in
                        the header. The two names sitting that close together is
                        the whose-thing-is-it split made visible in the chrome
                        itself — wireframe 94 · 56c. */}
                    <span className="truncate text-sm font-medium">
                      {personName ?? userEmail}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {settingsNav.label} · {accountNav.label}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>

              {/* Three items, and one of them is Sign out. The menu is small
                  because only two destinations belong behind it — a fourth row
                  would mean something got misfiled. The Office is not in here:
                  it is in the sidebar above, because you come back to it to
                  work. */}
              <DropdownMenuContent side="top" align="start" className="w-64">
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                  {userEmail}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem asChild className="py-2">
                  <Link href={settingsNav.href} className="flex-col !items-start gap-0.5">
                    <span className="text-sm font-medium">
                      {settingsNav.label}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {settingsNav.items.map((item) => item.title).join(" · ")}
                    </span>
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuItem asChild className="py-2">
                  <Link href={accountNav.href} className="flex-col !items-start gap-0.5">
                    <span className="text-sm font-medium">
                      {accountNav.label}
                    </span>
                    {/* A menu row that carries the answer saves the trip the
                        row exists to offer. */}
                    <span className="text-muted-foreground text-xs">
                      {[
                        accountNav.items.map((item) => item.title).join(" · "),
                        monthlyTotal,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={signingOut}
                  onSelect={(event) => {
                    // Keep the menu open while the request runs — the page is
                    // about to be replaced, and closing first hides the wait.
                    event.preventDefault();
                    void signOut();
                  }}
                >
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

/** Two letters for the avatar — the person's initials, or their address. */
function initials(name: string | null, email: string) {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}
