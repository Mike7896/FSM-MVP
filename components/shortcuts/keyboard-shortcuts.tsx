"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Keys, KeySequence } from "@/components/shortcuts/keys";
import {
  GO_TO,
  OPEN_SHORTCUTS_EVENT,
  SHORTCUT_GROUPS,
  isPlainKey,
  isTypingTarget,
} from "@/lib/shortcuts";

/** How long after G the second key still counts. */
const SEQUENCE_MS = 1200;

/**
 * The app-wide shortcuts, and the sheet that lists every shortcut.
 *
 * - `?` opens the sheet.
 * - `G` then a letter goes to a destination.
 * - `C` starts a new quote — unless the page has its own `C` (Schedule, Tasks),
 *   which handles the key first and wins.
 *
 * None of them fire while typing in a field. Page shortcuts live with their
 * pages; this sheet just lists them all in one place.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const goPending = useRef<number | null>(null);

  useEffect(() => {
    function clearSequence() {
      if (goPending.current !== null) window.clearTimeout(goPending.current);
      goPending.current = null;
    }

    // Capture phase, so the second key of "G then D" reaches us before a
    // page's own D (Schedule's day view) does.
    function onCapture(event: KeyboardEvent) {
      if (goPending.current === null) return;
      if (!isPlainKey(event) || isTypingTarget(event.target)) {
        clearSequence();
        return;
      }
      const target = GO_TO.find((entry) => entry.key === event.key.toLowerCase());
      clearSequence();
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      router.push(target.href);
    }

    // Bubble phase, after the page's handlers: a page that used the key has
    // called `preventDefault`, and the page's meaning wins.
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "?") {
        event.preventDefault();
        setOpen(true);
        return;
      }

      // An editor on screen turns the letters off: a stray C after clicking
      // a row's button would otherwise leave the quote mid-sentence.
      if (document.querySelector("[data-letter-shortcuts=off]")) return;

      if (event.key === "g" || event.key === "G") {
        if (event.shiftKey) return;
        event.preventDefault();
        clearSequence();
        goPending.current = window.setTimeout(clearSequence, SEQUENCE_MS);
      } else if (event.key === "c" && !event.shiftKey) {
        event.preventDefault();
        router.push("/quotes/new");
      }
    }

    function onOpen() {
      setOpen(true);
    }

    window.addEventListener("keydown", onCapture, { capture: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => {
      clearSequence();
      window.removeEventListener("keydown", onCapture, { capture: true });
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    };
  }, [router]);

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-3xl">
        <ResponsiveDialogHeader
          title="Keyboard shortcuts"
          description="Single-letter shortcuts work when you're not typing in a field."
        />
        <ResponsiveDialogBody className="grid gap-x-10 gap-y-6 pb-6 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="min-w-0">
              <h3 className="text-sm font-semibold">{group.title}</h3>
              {group.where ? (
                <p className="text-muted-foreground text-xs">{group.where}</p>
              ) : null}
              <dl className="mt-2 divide-y">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <dt className="text-muted-foreground min-w-0 text-sm">
                      {shortcut.label}
                    </dt>
                    <dd className="shrink-0">
                      {shortcut.sequence ? (
                        <KeySequence keys={shortcut.sequence} />
                      ) : (
                        <Keys keys={shortcut.keys} />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
