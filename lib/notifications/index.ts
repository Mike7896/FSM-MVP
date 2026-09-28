/**
 * NOTIFICATIONS — what reaches a person about their business, and whether it
 * got there. Content Design §7.6 · IA §3.4 · screen 44.
 *
 * **The dashboard is the inbox; this relays into it.** Every notification names
 * a state and links to the screen that changes it, and the channels exist to
 * bring someone who isn't looking at the dashboard back to that screen. There
 * is deliberately no second inbox here.
 *
 * The rest of the product touches this through one call: an operation that
 * changes a state somebody cares about calls `notifyLater` with the event. Who
 * hears, in which words, on which channel, and how it is retried all live here
 * — which is what keeps "send an email" out of route handlers.
 *
 * - `catalog` — the events, their labels and defaults. Client-safe; client
 *   components import that file directly, never this barrel.
 * - `compose` — an event, re-read from the database and put into words.
 * - `notify` — recipients, dedupe, preferences, the first send.
 * - `deliver` — the sending queue, its retries, and the daily summaries.
 * - `inbox` — the bell and the pop-ups: every notification, read or not.
 * - `sweeps` — the events time causes: overdue invoices, license renewals.
 * - `preferences` — what each person wants, per event and channel, and how
 *   they're reached: the number for texts, the summary hour, quiet hours.
 * - `clock` — what time it is on their clock.
 */
export * from "./catalog";
export type { NotificationEvent } from "./compose";
export { deliverDue, sendDigests } from "./deliver";
export { listInbox, markRead } from "./inbox";
export { notify, notifyLater } from "./notify";
export {
  getSettings,
  listPreferences,
  saveSettings,
  setPreference,
} from "./preferences";
export { runSweeps } from "./sweeps";
