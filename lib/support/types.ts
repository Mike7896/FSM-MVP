/**
 * What a contractor can send us, in their words. No server imports: the form,
 * the help page and the API read the same three kinds.
 */

export type SupportKind = "bug" | "idea" | "help";
export type SupportStatus = "open" | "answered" | "closed";

export type SupportKindCopy = {
  kind: SupportKind;
  /** The door on the help page. */
  label: string;
  /** Under it: what it's for. */
  lead: string;
  /** In their list, and on the email to us. */
  short: string;
  subjectLabel: string;
  bodyLabel: string;
  bodyHint: string;
  /** The button. */
  action: string;
};

export const SUPPORT_KINDS: SupportKindCopy[] = [
  {
    kind: "bug",
    label: "Report a problem",
    lead: "Something broken, wrong, or that makes no sense.",
    short: "Problem",
    subjectLabel: "What went wrong, in a line",
    bodyLabel: "What happened",
    bodyHint:
      "What you did, what you expected, and what happened instead. The page you were on comes with it.",
    action: "Send the report",
  },
  {
    kind: "idea",
    label: "Suggest a feature",
    lead: "Something you wish it did, or did differently.",
    short: "Idea",
    subjectLabel: "The idea, in a line",
    bodyLabel: "Tell us more",
    bodyHint: "What you're trying to get done, and how you do it today without it.",
    action: "Send the idea",
  },
  {
    kind: "help",
    label: "Get help from a person",
    lead: "Stuck, or a question the articles don't answer.",
    short: "Help",
    subjectLabel: "What you need, in a line",
    bodyLabel: "Details",
    bodyHint:
      "Which quote, job or customer it's about, and what you've tried. The more we know, the faster the answer.",
    action: "Send to support",
  },
];

export function supportKind(kind: SupportKind) {
  return SUPPORT_KINDS.find((entry) => entry.kind === kind)!;
}

export const STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Sent",
  answered: "Answered",
  closed: "Closed",
};

export type SupportRequestView = {
  id: string;
  number: number;
  kind: SupportKind;
  subject: string;
  body: string;
  status: SupportStatus;
  createdAt: string;
};

/** How many a person can send in an hour — enough for a bad day, not a flood. */
export const HOURLY_LIMIT = 10;
