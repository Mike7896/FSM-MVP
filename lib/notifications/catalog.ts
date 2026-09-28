/**
 * Every notification the product can send, and what each one starts as.
 *
 * **Client-safe on purpose.** Settings renders these rows and the API validates
 * a kind against the same list, so the screen and the server can never name
 * different events. Nothing here may import server code — client components
 * import this file directly, never the module's barrel.
 *
 * Ordered the way screen 44 orders them: by what a contractor would go looking
 * for first, which is money.
 *
 * **Defaults must be good enough that Settings never gets visited** (wireframe
 * 94). Push is on for what a contractor would act on within the hour; email is
 * on for what should still be waiting tomorrow. **Texts start off** for every
 * event: a text needs a number we don't have until they give one, and each one
 * costs money, so they are something a person turns on, never something that
 * starts arriving.
 *
 * Every event also lands in the app — the bell, and a pop-up while they're in
 * it. That isn't a channel to choose; it is where the business already is.
 *
 * `action` is the email's button — the verb for the screen the notification
 * opens, which is always the screen that changes the state, never the
 * dashboard (Flow 17).
 */
export const NOTIFICATION_KINDS = [
  {
    kind: "payment.received",
    label: "A deposit or draw clears",
    action: "Open the job",
    push: true,
    email: true,
    sms: false,
  },
  {
    kind: "quote.viewed",
    label: "A customer opens a quote",
    action: "Open the quote",
    push: true,
    email: false,
    sms: false,
  },
  {
    kind: "quote.accepted",
    label: "A quote is approved",
    action: "Open the contract",
    push: true,
    email: true,
    sms: false,
  },
  {
    kind: "inspection.result",
    label: "An inspection result lands",
    action: "Open the permit",
    push: true,
    email: false,
    sms: false,
  },
  {
    kind: "change.requested",
    label: "A customer requests a change",
    action: "Open the job",
    push: true,
    email: true,
    sms: false,
  },
  {
    kind: "invoice.overdue",
    label: "An invoice goes overdue",
    action: "Open the invoice",
    push: false,
    email: true,
    sms: false,
  },
  {
    kind: "license.renewal",
    label: "A license is up for renewal",
    action: "Open licenses",
    push: false,
    email: true,
    sms: false,
  },
  {
    kind: "visit.booked",
    label: "Someone books me on a visit",
    action: "Open the schedule",
    push: true,
    email: true,
    sms: false,
  },
  {
    kind: "task.assigned",
    label: "Someone gives me a task",
    action: "Open the task",
    push: true,
    email: true,
    sms: false,
  },
  {
    kind: "billing.notice",
    label: "My ServiceClerk membership needs attention",
    action: "Open billing",
    push: true,
    email: true,
    sms: false,
  },
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]["kind"];

/** The kinds alone, in the tuple shape `z.enum` wants. */
export const NOTIFICATION_KIND_IDS = NOTIFICATION_KINDS.map(
  (entry) => entry.kind
) as [NotificationKind, ...NotificationKind[]];

export type NotificationChannel = "push" | "email" | "sms";

/** One row of screen 44, with this person's choices filled in. */
export type NotificationPreference = {
  kind: NotificationKind;
  label: string;
  push: boolean;
  email: boolean;
  sms: boolean;
};

/**
 * How one person is reached, across every event. Mirrors the settings row,
 * with its defaults filled in when there isn't one.
 */
export type NotificationSettings = {
  emailFrequency: "instant" | "daily";
  digestHour: number;
  smsPhone: string | null;
  quietHours: boolean;
  quietStart: number;
  quietEnd: number;
  timeZone: string | null;
  toasts: boolean;
};

/** What reaching someone looks like before they have saved anything. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  emailFrequency: "instant",
  digestHour: 8,
  smsPhone: null,
  quietHours: false,
  quietStart: 21,
  quietEnd: 7,
  timeZone: null,
  toasts: true,
};

/** One notification as the bell and the pop-ups show it. */
export type InboxItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};
