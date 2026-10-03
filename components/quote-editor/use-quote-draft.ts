"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  draftFromRecord,
  hasChanges,
  idsByKey,
  toSavePayload,
  withIds,
  type QuoteDraft,
  type QuoteRecord,
} from "@/lib/quote";

/**
 * The draft, and keeping it saved.
 *
 * **There is no Save button.** Every change debounces into a write — a pause in
 * typing saves, the way a Google Doc does — and the header reports what
 * happened.
 *
 * The rules the implementation holds:
 *
 * 1. **Local state is the truth while editing.** A response never overwrites a
 *    field being typed in — only ids and server-assigned values (`number`, row
 *    ids) are merged back, matched to rows by their client `key`, so rows added
 *    or moved while a write was out keep their own identity.
 *
 * 2. **One write in flight at a time.** Saves are serialised, so two PATCHes
 *    carrying different row sets can never land out of order.
 *
 * 3. **A failed save is never silent and never destructive.** The draft stays
 *    exactly as typed, the status says so, and it retries on its own — sooner
 *    when the connection comes back.
 *
 * 4. **Leaving saves.** Closing the editor inside the app, hiding the tab or
 *    closing it writes whatever hasn't been written; closing the tab with a
 *    change still unsaved asks first.
 */

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** The pause after the last change before it saves. */
const DEBOUNCE_MS = 900;

/** How long `saveNow` waits on a write that was already out. */
const FLUSH_TIMEOUT_MS = 15_000;

/** Retries after a failure wait 2s, 4s, 8s … and never more than a minute. */
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/**
 * Bodies under this go with `keepalive`, so a write started as the tab closes
 * still lands. Browsers refuse keepalive bodies over 64KB, so a very large
 * quote goes without it rather than not at all.
 */
const KEEPALIVE_MAX_BYTES = 60_000;

const OFFLINE_MESSAGE =
  "Couldn't reach the server. Your changes are still here and will save when the connection is back.";

type Options = {
  /** A loaded quote, or an empty draft. The row is created by the first save. */
  initial: QuoteDraft;
  saveRequest?: (draft: QuoteDraft) => Promise<Response>;
  /**
   * Create-time context the draft does not carry. Taken as primitives rather
   * than an object so the save callback keeps a stable identity.
   */
  jobId?: string;
  /** Set when the quote was started from a customer's page. */
  customerId?: string;
  address?: string;
  packId?: string;
  /**
   * Started on the demo start. Sent with the create call, so the Job and the
   * Customer it makes carry the demo flag from their first row.
   */
  demo?: boolean;
  /** Held off until the shop exists during activation, and off in previews. */
  autosave?: boolean;
};

export function useQuoteDraft({
  initial,
  saveRequest,
  jobId,
  customerId,
  address,
  packId,
  demo = false,
  autosave = true,
}: Options) {
  const [draft, setDraft] = useState<QuoteDraft>(initial);
  const [saved, setSaved] = useState<QuoteDraft>(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  /** Bumped on every failure, so the retry below re-arms with a longer wait. */
  const [failures, setFailures] = useState(0);
  /** Whether the last failure is worth retrying — a refusal (4xx) isn't. */
  const [retryable, setRetryable] = useState(false);

  // Touched only inside the async save, never during render.
  const inFlight = useRef(false);
  const queued = useRef<QuoteDraft | null>(null);
  /**
   * The last draft the server confirmed, identity and all, or null when the
   * most recent write failed. What `saveNow` hands back — a caller about to
   * send needs to know the row it is sending, and that it is current.
   */
  const confirmed = useRef<QuoteDraft | null>(initial.id ? initial : null);

  /** Every edit goes through here, so nothing mutates a draft in place. */
  const update = useCallback(
    (recipe: (current: QuoteDraft) => QuoteDraft) => setDraft(recipe),
    []
  );

  const save = useCallback(
    async (first: QuoteDraft) => {
      if (inFlight.current) {
        // Something changed while a write was out. Remember the newest version
        // and let the running loop pick it up, rather than racing it — rule 2.
        queued.current = first;
        return;
      }

      inFlight.current = true;

      try {
        // Drains the queue in a loop rather than by recursing, which is what
        // lets React's compiler keep this memoized.
        let current: QuoteDraft | null = first;

        while (current) {
          setStatus("saving");
          setError(null);

          let server: QuoteDraft;
          try {
            server = await write(current);
          } catch (cause) {
            const failure = cause instanceof SaveFailure ? cause : null;
            confirmed.current = null;
            setStatus("error");
            setError(failure?.message ?? OFFLINE_MESSAGE);
            setRetryable(failure ? failure.retryable : true);
            setFailures((count) => count + 1);
            // Stop draining. The retry below — or the next change — writes
            // the newest draft, so the queued one has nothing to add.
            queued.current = null;
            break;
          }

          // Rule 1: merge identity, not content. Rows are matched by key, so
          // whatever was typed, added or moved since this request left stays
          // exactly as it is and keeps its own id.
          const ids = idsByKey(current.scope, server.scope);
          const adopted = adopt(current, server, ids);

          setDraft((live) => adopt(live, server, ids));
          setSaved(adopted);
          confirmed.current = adopted;
          setStatus("saved");
          setFailures(0);
          setRetryable(false);

          // A change queued behind this write was captured before its
          // response, so it takes the identity the write just confirmed —
          // otherwise a first save's follow-up would create a second quote,
          // and its new rows would be written again as new.
          const next: QuoteDraft | null = queued.current;
          queued.current = null;
          current = next ? adopt(next, server, ids) : null;
        }
      } finally {
        inFlight.current = false;
      }

      async function write(target: QuoteDraft): Promise<QuoteDraft> {
        let response: Response;
        try {
          if (saveRequest) {
            response = await saveRequest(target);
          } else {
            const body = JSON.stringify(
              target.id
                ? toSavePayload(target)
                : {
                    ...toSavePayload(target),
                    jobId,
                    // An explicit id beats the name match the endpoint would
                    // otherwise fall back on.
                    customerId,
                    address,
                    packId,
                    demo,
                  }
            );
            response = await fetch(
              target.id ? `/api/v1/quotes/${target.id}` : "/api/v1/quotes",
              {
                method: target.id ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body,
                keepalive: body.length < KEEPALIVE_MAX_BYTES,
              }
            );
          }
        } catch {
          // The request never got an answer — offline, or the connection
          // dropped. Always worth trying again.
          throw new SaveFailure(OFFLINE_MESSAGE, true);
        }

        const body = (await response.json().catch(() => null)) as {
          data?: QuoteRecord;
          error?: { message?: string };
        } | null;

        if (!response.ok || !body?.data) {
          // The server's own refusals — an accepted quote, a bad field — won't
          // change by asking again. Its failures and rate limits might.
          const retry =
            response.status >= 500 ||
            response.status === 408 ||
            response.status === 429;
          throw new SaveFailure(
            body?.error?.message ?? "Couldn't save. Your changes are still here.",
            retry
          );
        }

        return draftFromRecord(body.data);
      }
    },
    [jobId, customerId, address, packId, demo, saveRequest]
  );

  // The save the timers should call. Held in a ref and refreshed after commit,
  // so the debounce below can depend on the draft alone.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const dirty = hasChanges(draft, saved);

  // The debounce, re-armed by every change to the draft.
  useEffect(() => {
    if (!autosave || !dirty) return;
    const timer = setTimeout(() => void saveRef.current(draft), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, dirty, autosave]);

  // Rule 3: after a failure, try again on a growing delay, and straight away
  // when the browser says it's back online. A change in the meantime re-arms
  // the debounce above, which saves sooner.
  useEffect(() => {
    if (!autosave || !dirty || status !== "error" || !retryable) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1));
    const retry = () => void saveRef.current(draft);
    const timer = setTimeout(retry, delay);
    window.addEventListener("online", retry);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", retry);
    };
  }, [autosave, dirty, status, retryable, failures, draft]);

  /**
   * Flush before the tab goes away.
   *
   * `visibilitychange` rather than `beforeunload`, because iOS Safari does not
   * reliably fire the latter — and backgrounding the app mid-quote is the most
   * likely way this screen gets left.
   */
  useEffect(() => {
    if (!autosave || !dirty) return;
    function flush() {
      if (document.visibilityState === "hidden") void saveRef.current(draft);
    }
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [draft, dirty, autosave]);

  /**
   * Closing or reloading the tab with a change not yet written asks first.
   * Browsers show their own wording; the flush above has already started the
   * write, so staying a second is usually all it needs.
   */
  const unsaved = autosave && (dirty || status === "saving");
  useEffect(() => {
    if (!unsaved) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  /**
   * Leaving the editor inside the app — a sidebar link straight after typing —
   * unmounts it before the debounce fires. The latest draft is kept in a ref so
   * the unmount can write it.
   */
  const latest = useRef({ draft, dirty, autosave });
  useEffect(() => {
    latest.current = { draft, dirty, autosave };
  }, [draft, dirty, autosave]);
  useEffect(
    () => () => {
      const { draft: last, dirty: changed, autosave: on } = latest.current;
      if (on && changed) void saveRef.current(last);
    },
    []
  );

  /**
   * Forces a write now and hands back the saved row — used before preview and
   * send. Null when the latest write failed, so a caller never sends a quote
   * whose newest changes didn't land.
   *
   * Written regardless of `autosave`: activation holds the debounce off until
   * the Office exists, and the send is the moment it has to go in.
   */
  const saveNow = useCallback(async (): Promise<QuoteDraft | null> => {
    // A quote never written has no row yet, changed or not — one opened from a
    // sentence and sent untouched is still a quote to create.
    if (dirty || !confirmed.current) await saveRef.current(draft);

    // A write that was already out when this was called — the debounce's, or
    // one queued behind it — has to land before the answer means anything.
    const started = Date.now();
    while (inFlight.current && Date.now() - started < FLUSH_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return confirmed.current;
  }, [draft, dirty]);

  return {
    draft,
    update,
    setDraft,
    // A dirty draft is never reported as saved, even between debounce ticks.
    status: dirty && status === "saved" ? "idle" : status,
    error,
    dirty,
    saveNow,
  } as const;
}

class SaveFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

/**
 * Takes the server's identity without taking the server's content: the quote's
 * ids and number, and each row's id by its key.
 */
function adopt(
  live: QuoteDraft,
  server: QuoteDraft,
  ids: Map<string, string>
): QuoteDraft {
  return {
    ...live,
    id: server.id,
    number: server.number,
    jobId: server.jobId,
    customerId: server.customerId,
    status: server.status,
    scope: withIds(live.scope, ids),
  };
}
