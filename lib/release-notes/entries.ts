/**
 * Release Notes — what has actually landed in this app, newest first.
 *
 * **Called what it is.** Every person who has ever updated an app knows what
 * release notes are on sight, and a contractor opening this should not have to
 * decode a metaphor to find out whether the thing they use every day moved.
 *
 * **Why it exists.** This product is built by one person, in the open, a piece
 * at a time. A contractor who can see the work happening knows the thing they
 * bought is alive and knows when something they use has moved. A product that
 * ships silently asks them to take that on faith.
 *
 * **Content lives in code, on purpose.** An entry ships in the same release as
 * the work it describes, so the two cannot disagree, and a change to this list
 * is a line in a diff a reviewer reads. No CMS, no table, no publish step.
 *
 * Writing one:
 * - `date` is the day it reached the app, `YYYY-MM-DD`.
 * - `title` is what somebody would tell a contractor in one breath.
 * - Every line is in the contractor's words, about what they can now do — not
 *   about the code that does it. "Bring your customers in from a spreadsheet",
 *   never "added CSV import endpoint".
 */

export type BuildKind = "new" | "better" | "fixed";

export type BuildItem = {
  kind: BuildKind;
  text: string;
};

export type BuildEntry = {
  /** `YYYY-MM-DD`, the day it landed. */
  date: string;
  title: string;
  items: BuildItem[];
};

export const KIND_LABEL: Record<BuildKind, string> = {
  new: "New",
  better: "Better",
  fixed: "Fixed",
};

/** Newest first. The order here is the order on the page. */
export const RELEASE_NOTES: BuildEntry[] = [
  {
    date: "2026-09-24",
    title: "The visit sits beside the quote, always",
    items: [
      {
        kind: "fixed",
        text: "From the visit — photos, notes and measurements — is now always beside the quote editor, including on a brand-new quote. It used to appear only once there was something in it, which is the one time you'd never meet it.",
      },
      {
        kind: "new",
        text: "Fold it away with the arrow in its corner when you want the room. It stays folded until you open it again.",
      },
      {
        kind: "better",
        text: "The first-quote tour now stops at it and says what it's for.",
      },
    ],
  },
  {
    date: "2026-09-23",
    title: "Documents look like documents",
    items: [
      {
        kind: "better",
        text: "A quote now reads as a page: US Letter, one-inch margins, 11pt text, and your business name and the quote number in the footer. The same page is what your customer opens and what comes out of a printer.",
      },
      {
        kind: "better",
        text: "Quotes on a shelf are drawn as sheets of paper with a turned-down corner, not as cards. Hover one and its customer, total and status come up over the page.",
      },
      {
        kind: "new",
        text: "Every quote now has a View mode and an Edit mode. View is the document as your customer reads it, and it's what prints — save it as a PDF from there.",
      },
      {
        kind: "new",
        text: "One search box in the header, over jobs, quotes, contracts, change orders, invoices and customers at once. ⌘K opens it with more room.",
      },
      {
        kind: "new",
        text: "You can follow the build on Facebook and Instagram — the links are at the foot of the marketing site.",
      },
    ],
  },
  {
    date: "2026-09-22",
    title: "Your data goes both ways",
    items: [
      {
        kind: "new",
        text: "Bring your customers in from a spreadsheet. You see every row and what would happen to it before anything is saved, and anyone already in your directory is flagged rather than merged.",
      },
      {
        kind: "new",
        text: "Take everything out: customers, jobs, quotes, contracts, change orders, invoices, payments, receipts and permits, as spreadsheets or in one file.",
      },
      {
        kind: "new",
        text: "Send a copy of a contract to your customer, by email or as a link, on the same link they sign on.",
      },
      {
        kind: "new",
        text: "Start a job from New job: search your customers or add one by name, and the job opens ready for its quote.",
      },
      {
        kind: "new",
        text: "Catch a walkthrough on the job: photos, notes and measurements land on the job and show up beside the quote you write from them.",
      },
      {
        kind: "better",
        text: "Cancelling a subscription now shows your real open jobs and your real billing date, and hands off to Stripe's own cancel screen.",
      },
      {
        kind: "fixed",
        text: "Trade pack pages no longer advertise templates that aren't built yet, and the developer notes boxes are gone from the pages that showed them.",
      },
    ],
  },
];

/** The day the newest entry landed — what "is there anything new" compares to. */
export const LATEST_NOTE = RELEASE_NOTES[0]?.date ?? "";

/** How many entries a person hasn't seen, given the last date they looked. */
export function unseenCount(seen: string | null): number {
  if (!seen) return RELEASE_NOTES.length;
  return RELEASE_NOTES.filter((entry) => entry.date > seen).length;
}

/** Where the page lives, and what it is called, in one place. */
export const RELEASE_NOTES_ROUTE = "/release-notes";
export const RELEASE_NOTES_TITLE = "Release Notes";
