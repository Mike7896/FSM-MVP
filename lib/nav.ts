import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Blocks,
  BookOpen,
  Building2,
  CalendarDays,
  CreditCard,
  Database,
  FileText,
  Hammer,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  Plug,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Users,
  ChartColumn,
} from "lucide-react";

import { PACKS } from "@/lib/packs/catalog";

/**
 * Navigation is settled in Information Architecture §3.1, §3.2 and §5.3.
 *
 * The rule that fixes the primary list: **a navigation destination must be an
 * object** — something you can get a list of instances of. That is why there is
 * no "Money" destination, which would be a view over Invoices and Payments, and
 * why Quote and Invoice are two entries rather than one lifecycle.
 *
 * **The Office is the one exception, and a deliberate one.** It is not an
 * object either — one instance, no lifecycle — but a contractor *returns to it
 * to work*, so it earns a sidebar slot where Settings and Account do not. Those
 * two sit behind the account menu, visited rarely and on purpose.
 *
 * The wireframe set was drawn against an invented alternative
 * (Home · Jobs · Money · Customers · Price book · Settings) and against a
 * single Settings wing. Both are superseded — the IA is the source of truth,
 * so this file follows the IA.
 */

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** One line on what the destination is for. */
  description?: string;
  /** Shown when the destination is reserved but not yet built out. */
  reserved?: boolean;
};

/** Desktop web sidebar — IA §3.1, ordered by frequency and workflow. */
export const primaryNav: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Quotes", href: "/quotes", icon: FileText },
  { title: "Jobs", href: "/jobs", icon: Hammer },
  // Visits are the object; the schedule is their list, laid out in time.
  { title: "Schedule", href: "/schedule", icon: CalendarDays },
  // Tasks are the object; the board and the list are two ways to lay them out.
  { title: "Tasks", href: "/tasks", icon: ListTodo },
  { title: "Customers", href: "/customers", icon: Users },
  { title: "Invoices", href: "/invoices", icon: ReceiptText },
  // Pro's business analytics (Billing §2.2) — the page explains itself below Pro.
  { title: "Analytics", href: "/analytics", icon: ChartColumn },
  { title: "Price Book", href: "/price-book", icon: BookOpen, reserved: true },
  { title: "Office", href: "/office", icon: Building2 },
];

/**
 * The native app's five tabs — IA §3.2. Routes are a web concept and the app
 * navigates by tab and stack, but every app screen is still identified by the
 * route of the object it addresses, which is what keeps one screen inventory
 * rather than two. Kept here so the two surfaces cannot drift.
 *
 * **More** is where the occasional-use wing lands on the phone, and most of
 * what it leads to links out to the web rather than being built twice.
 */
export const appTabs = [
  { title: "Today", href: "/dashboard", icon: LayoutDashboard },
  { title: "Jobs", href: "/jobs", icon: Hammer },
  { title: "New", href: "#new", icon: Sparkles },
  { title: "Quotes", href: "/quotes", icon: FileText },
  { title: "More", href: "/office", icon: Settings },
] as const;

/**
 * The three occasional-use destinations — IA §5.3.
 *
 * Split by **whose thing it is**, and that split is the whole reason none of
 * them becomes a junk drawer:
 *
 * - **The Office** is the business — identity, house rules, credentials, and
 *   the connections to everything outside the product.
 * - **Settings** is the app — how the tool behaves and looks for this person.
 * - **Account** is the user — who you are to us, and what you pay us with.
 *
 * A setting that seems to fit two is usually two settings.
 */
export type NavSection = {
  /** What the destination is called, in full. */
  label: string;
  href: string;
  /** One line on whose thing this is — IA §5.3. */
  character: string;
  items: NavItem[];
};

/**
 * The Office — the business itself.
 *
 * Every label matches its route segment, which is IA §2's rule: where a route
 * and a label diverge, one of them is wrong. That is why *Document branding*
 * sits at `/office/branding` and not at `/office/appearance` — Appearance is a
 * different word for a different thing, and it belongs to the person.
 */
export const officeNav: NavSection = {
  label: "The Office",
  href: "/office",
  character: "The business — identity, house rules, credentials, connections",
  items: [
    {
      title: "Business identity",
      href: "/office",
      icon: Building2,
      description:
        "Name, address, contact and logo — what a customer reads first",
    },
    {
      title: "Document branding",
      href: "/office/branding",
      icon: ScrollText,
      description:
        "How a quote, contract and invoice look on paper and on the link",
    },
    {
      title: "Defaults",
      href: "/office/defaults",
      icon: SlidersHorizontal,
      description: "Where every new quote starts — money, scope language, terms",
    },
    {
      title: "Licenses",
      href: "/office/licenses",
      icon: ShieldCheck,
      description:
        "Every jurisdiction you are legal to work in, and when each renews",
    },
    {
      title: "Automations",
      href: "/office/automations",
      icon: Sparkles,
      description: "Everything the app does on its own, including in your name",
      // Nothing on the page saves yet — its switches need a table this build
      // doesn't have. Clear this when they persist.
      reserved: true,
    },
    {
      title: "Trade packs",
      href: "/office/packs",
      icon: Blocks,
      description: "What your trade adds to the quote editor",
      // Read off the catalogue, so it clears itself the day a pack ships.
      reserved: PACKS.every((pack) => pack.status === "coming"),
    },
    {
      title: "Connections",
      href: "/office/connections",
      icon: Plug,
      description:
        "Accounting, payment rails, mail — and how healthy each one is",
    },
    {
      title: "Data",
      href: "/office/data",
      icon: Database,
      description: "Bring your history in, and take everything out",
    },
  ],
};

/**
 * Settings — the app, for this person. **One screen, no section list.**
 *
 * That is the finding wireframe 94 · 56b was drawn to prove: everything that
 * used to make Settings feel like a wing turned out to belong to the business,
 * and once it moved to the Office what remained is genuinely small. A short
 * screen here is evidence the split is right, not a screen that needs filling
 * — so `items` describes what is *on* the page rather than what to navigate
 * between.
 */
export const settingsNav: NavSection = {
  label: "Settings",
  href: "/settings",
  character: "The app — how the tool behaves and looks for you",
  items: [
    {
      title: "Appearance",
      href: "/settings#appearance",
      icon: Sun,
      description: "Light or dark. How the app looks to you",
    },
    {
      title: "Notifications",
      href: "/settings#notifications",
      icon: Bell,
      description: "What reaches you, and on which channel",
    },
  ],
};

/**
 * Account — the person, and what they pay us with. One screen, as above.
 *
 * **No destination is named after a vendor.** What the contractor pays *us*
 * with lives here; the rails they *collect* with live in the Office's
 * connections. Stripe and QuickBooks are rows inside those pages, never labels
 * on them, which is what lets the supported set change without renaming a
 * destination.
 */
export const accountNav: NavSection = {
  label: "Account",
  href: "/account",
  character: "You — who you are to us, and what you pay us with",
  items: [
    {
      title: "Sign-in",
      href: "/account#sign-in",
      icon: KeyRound,
      description: "Email, password and the accounts you sign in with",
    },
    {
      title: "Billing",
      href: "/account#billing",
      icon: CreditCard,
      description: "Your plan, what is next, and every receipt",
    },
  ],
};

/**
 * What the Office's section list says about the two destinations that are not
 * in it — wireframe 94 · 56a, and it is a sentence rather than two links on
 * purpose. Pointing at the account menu teaches where they live; linking to
 * them from here would quietly make the Office their parent, which is the one
 * relationship the whole split exists to deny.
 */
export const OFFICE_RAIL_NOTE =
  "Settings and Account are not here. They sit under your name, top right — the app's, and yours.";

/**
 * The native app's **More** tab — wireframe 94 · 56d.
 *
 * The wing is not in the app, and the app says so rather than pretending it is
 * absent: nobody tunes exclusions in a truck, but they do go looking for them,
 * and a dead end is worse than a browser. Every row that hands off announces it
 * *before* the tap.
 *
 * Two rows are exceptions and both earn it. **Licenses** is lifted out of the
 * Office because attaching the right one happens on site, at the moment a quote
 * is built for a township — reading and attaching ship in the app, adding one
 * does not. **Upgrade** is the other, and it lives in the subscription flow: a
 * send limit fires in a customer's kitchen, so the warning, the prompt and the
 * checkout are all in the app even though managing a plan afterwards is not.
 */
export const moreTab = [
  { title: "Customers", href: "/customers", where: "app" },
  { title: "Invoices", href: "/invoices", where: "app" },
  {
    title: "The Office",
    href: "/office",
    where: "browser",
    detail:
      "Identity · document branding · defaults · automations · packs · connections · data",
  },
  {
    title: "Licenses",
    href: "/office/licenses",
    where: "app",
    detail: "Read them and attach them. Adding one opens the browser.",
  },
  {
    title: "Settings",
    href: "/settings",
    where: "app",
    detail: "Appearance · notifications — both of them are about this phone",
  },
  {
    title: "Account",
    href: "/account",
    where: "browser",
    detail: "Your plan and your card. Upgrading is the one exception, and it happens in the app.",
  },
] as const;

/**
 * The ➕ New sheet — IA §3.3. Every door creates the Job silently behind it.
 * Change order deliberately has no door: it amends a Contract, and there is
 * nothing to amend without one.
 */
export const createDoors = [
  {
    title: "New quote",
    description: "Price a job. The usual door.",
    href: "/quotes/new",
    primary: true,
  },
  {
    title: "Start capture",
    description: "Walk the job now, quote it after.",
    href: "/jobs?capture=1",
    primary: false,
  },
  {
    title: "New contract",
    description: "You agreed it on the phone and never quoted it.",
    href: "/contracts/new",
    primary: false,
  },
  {
    title: "New invoice",
    description: "Bill it. There was never a contract.",
    href: "/invoices/new",
    primary: false,
  },
  {
    title: "New job",
    description: "Several documents coming. You already know it.",
    href: "/jobs/new",
    primary: false,
  },
] as const;

