import type { Metadata } from "next";

import { MarkReleaseNotesSeen } from "@/components/release-notes/seen";
import { PageHeader } from "@/components/page-header";
import {
  RELEASE_NOTES,
  RELEASE_NOTES_TITLE,
  KIND_LABEL,
  type BuildKind,
} from "@/lib/release-notes/entries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: RELEASE_NOTES_TITLE };

/**
 * Release Notes · what has actually landed, newest first.
 *
 * **A one-person product has to be visibly alive.** Software that arrives
 * finished is a promise somebody else's marketing made; software that visibly
 * grows every week is a thing you can watch being built for you. That is the
 * whole job of this page, and it is why it is plain: dates, headings, and lines
 * in the contractor's own words.
 *
 * **It says what landed, never what is coming.** A roadmap on the same page
 * would turn a record into a set of promises, and the one thing this page is
 * for is being true.
 */
export default function ReleaseNotesPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10">
      <MarkReleaseNotesSeen />

      <PageHeader
        title={RELEASE_NOTES_TITLE}
        description="What landed in the app, and when. Newest first."
      />

      <div className="flex flex-col gap-10">
        {RELEASE_NOTES.map((entry) => (
          <section key={entry.date} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
              <h2 className="text-base font-semibold tracking-tight">
                {entry.title}
              </h2>
              <time
                dateTime={entry.date}
                className="text-muted-foreground text-xs tabular-nums"
              >
                {readableDate(entry.date)}
              </time>
            </div>

            <ul className="flex flex-col gap-3">
              {entry.items.map((item, index) => (
                <li key={index} className="flex gap-3">
                  <Kind kind={item.kind} />
                  <span className="min-w-0 text-sm leading-relaxed">
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-muted-foreground border-t pt-5 text-sm leading-relaxed">
        This app is built by one person, a piece at a time, with the people
        using it. Anything here can be changed by telling us it&apos;s wrong.
      </p>
    </div>
  );
}

/** Three kinds, told apart by a word rather than a colour. */
function Kind({ kind }: { kind: BuildKind }) {
  return (
    <span
      className={cn(
        "mt-0.5 w-12 shrink-0 font-label text-[10px] uppercase",
        kind === "new" ? "text-primary-ink" : "text-muted-foreground"
      )}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

function readableDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
