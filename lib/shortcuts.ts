/**
 * Keyboard shortcuts — the list the `?` sheet shows, and the small helpers
 * every handler shares.
 *
 * Keys are written once, platform-neutral: `Mod` is ⌘ on a Mac and Ctrl
 * everywhere else, `Alt` is ⌥ on a Mac. `components/shortcuts/keys.tsx` draws
 * them for the platform the person is on.
 */

export type KeyName =
  | "Mod"
  | "Alt"
  | "Shift"
  | "Enter"
  | "Backspace"
  | "ArrowUp"
  | "ArrowDown"
  | "Escape"
  | (string & {});

export type Shortcut = {
  /** Pressed together. */
  keys: KeyName[];
  /** Pressed one after the other — "G then Q". Used instead of `keys`. */
  sequence?: KeyName[];
  label: string;
};

export type ShortcutGroup = {
  title: string;
  /** Where the group applies, when that isn't everywhere. */
  where?: string;
  shortcuts: Shortcut[];
};

/** Where "G then a letter" goes. The letters are the destinations' initials. */
export const GO_TO: { key: string; label: string; href: string }[] = [
  { key: "d", label: "Dashboard", href: "/dashboard" },
  { key: "q", label: "Quotes", href: "/quotes" },
  { key: "j", label: "Jobs", href: "/jobs" },
  { key: "s", label: "Schedule", href: "/schedule" },
  { key: "t", label: "Tasks", href: "/tasks" },
  { key: "c", label: "Customers", href: "/customers" },
  { key: "i", label: "Invoices", href: "/invoices" },
  { key: "a", label: "Analytics", href: "/analytics" },
  { key: "o", label: "Office", href: "/office" },
];

export const ROW_KEYS = {
  moveUp: ["Alt", "ArrowUp"],
  moveDown: ["Alt", "ArrowDown"],
  remove: ["Alt", "Shift", "Backspace"],
  duplicate: ["Alt", "Shift", "ArrowDown"],
  addBelow: ["Enter"],
} satisfies Record<string, KeyName[]>;

export const EDITOR_KEYS = {
  addToScope: ["Alt", "N"],
  save: ["Mod", "S"],
  preview: ["Mod", "Enter"],
} satisfies Record<string, KeyName[]>;

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Anywhere",
    where: "The single letters are off while a quote is open",
    shortcuts: [
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["Mod", "K"], label: "Search everything" },
      { keys: ["/"], label: "Search" },
      { keys: ["C"], label: "New quote" },
      { keys: ["Mod", "B"], label: "Show or hide the sidebar" },
    ],
  },
  {
    title: "Go to",
    shortcuts: GO_TO.map((entry) => ({
      keys: [],
      sequence: ["G", entry.key.toUpperCase()],
      label: entry.label,
    })),
  },
  {
    title: "Quote editor",
    shortcuts: [
      { keys: EDITOR_KEYS.addToScope, label: "Add to scope" },
      { keys: ["1–6"], label: "In Add to scope: pick the kind of row" },
      { keys: EDITOR_KEYS.save, label: "Save now" },
      { keys: EDITOR_KEYS.preview, label: "Preview & send" },
    ],
  },
  {
    title: "Scope rows",
    where: "While you're typing in a row",
    shortcuts: [
      { keys: ROW_KEYS.addBelow, label: "New line item below (in a group's name: inside it)" },
      { keys: ROW_KEYS.moveUp, label: "Move row up" },
      { keys: ROW_KEYS.moveDown, label: "Move row down" },
      { keys: ROW_KEYS.duplicate, label: "Duplicate row (and everything in it)" },
      { keys: ROW_KEYS.remove, label: "Delete row" },
    ],
  },
  {
    title: "Schedule",
    shortcuts: [
      { keys: ["T"], label: "Today" },
      { keys: ["J"], label: "Next" },
      { keys: ["K"], label: "Previous" },
      { keys: ["D"], label: "Day view" },
      { keys: ["W"], label: "Week view" },
      { keys: ["M"], label: "Month view" },
      { keys: ["C"], label: "New visit" },
    ],
  },
  {
    title: "Tasks",
    shortcuts: [
      { keys: ["C"], label: "New task" },
      { keys: ["/"], label: "Search tasks" },
    ],
  },
];

/**
 * Whether a key press belongs to whatever has focus rather than to a
 * shortcut — typing in a field, or a menu or dialog that handles its own keys.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest(
      "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role=dialog], [role=menu], [role=listbox]"
    ) !== null
  );
}

/** ⌘ on a Mac, Ctrl elsewhere — either is accepted, so nobody is punished for habit. */
export function hasMod(event: KeyboardEvent | React.KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

/** A shortcut with no modifier — the single-letter kind. */
export function isPlainKey(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey;
}

/** Fired to open the shortcuts sheet from a menu item. */
export const OPEN_SHORTCUTS_EVENT = "shortcuts:open";
