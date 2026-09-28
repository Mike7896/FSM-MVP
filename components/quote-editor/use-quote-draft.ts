"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  draftFromRecord,
  flatten,
  hasChanges,
  toSavePayload,
  type QuoteDraft,
  type QuoteRecord,
  type ScopeNode,
} from "@/lib/quote";

/**
 * The draft, and keeping it saved.
 *
 * **The contractor never presses Save.** He is standing in someone's kitchen
 * with one hand on the phone; a Save button is a thing to forget, and the quote
 * he loses is the one he was about to send. So every change debounces into a
 * write and the interface reports what happened rather than asking permission.
 *
 * Three rules the implementation exists to hold:
 *
 * 1. **Local state is the truth while editing.** A response never overwrites a
 *    field he is currently typing in — only ids and server-assigned values
 *    (`number`, line ids) are merged back. Anything else produces the cursor
 *    jumping backwards mid-word, which is the classic autosave bug.
 *
 * 2. **One write in flight at a time.** Saves are serialised rather than fired
 *    per change, so two PATCHes carrying different line sets can never land out
 *    of order and leave the quote holding the older one.
 *
 * 3. **A failed save is never silent and never destructive.** The draft stays
 *    exactly as typed, the status says so, and the next change retries.
 *
 * What the server last confirmed is held as **state, not a ref**, so that
 * `dirty` is derived purely during render — reading a ref there would be a lie
 * about when the value changed, and React's compiler is right to reject it.
 */

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Long enough that typing a line doesn't chatter, short enough to feel live. */
const DEBOUNCE_MS = 900;

/** How long `saveNow` waits on a write that was already out. */
const FLUSH_TIMEOUT_MS = 15_000;

type Options = {
  /** A loaded quote, or an empty draft. The row is created by the first save. */
  initial: QuoteDraft;
  saveRequest?: (draft: QuoteDraft) => Promise<Response>;
  /**
   * Create-time context the draft does not carry. Taken as primitives rather
   * than an object so the effect below has stable dependencies — an object
   * literal from the caller would be a new identity every render and would
   * re-arm the debounce on every parent update.
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
        // Drains the queue in a loop rather than by recursing. Same behaviour,
        // but the function never references itself, which is what lets React's
        // compiler keep this memoized.
        let current: QuoteDraft | null = first;

        while (current) {
          setStatus("saving");
          setError(null);

          try {
            const payload = toSavePayload(current);

            const response = saveRequest ? await saveRequest(current) : current.id
              ? await fetch(`/api/v1/quotes/${current.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
                })
              : await fetch("/api/v1/quotes", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    ...payload,
                    jobId,
                    // An explicit id beats the name match the endpoint would
                    // otherwise fall back on — the same name typed twice
                    // should not become two people.
                    customerId,
                    address,
                    packId,
                    demo,
                  }),
                });

            const body = (await response.json().catch(() => null)) as {
              data?: QuoteRecord;
              error?: { message?: string };
            } | null;

            if (!response.ok || !body?.data) {
              throw new Error(
                body?.error?.message ??
                  "Couldn't save. Your changes are still here."
              );
            }

            const server = draftFromRecord(body.data);
            const written = current;
            const adopted = adoptIdentity(written, server);

            // Rule 1: merge identity, not content. Whatever he has typed since
            // this request left stays exactly as typed.
            setDraft((live) => adoptIdentity(live, server));
            setSaved(adopted);
            confirmed.current = adopted;
            setStatus("saved");
          } catch (cause) {
            confirmed.current = null;
            setStatus("error");
            setError(
              cause instanceof Error
                ? cause.message
                : "Couldn't save. Your changes are still here."
            );
            // Stop draining on failure. The debounce retries on the next
            // keystroke, and hammering a failing endpoint helps nobody.
            queued.current = null;
            break;
          }

          // A change queued behind a first write was captured before that
          // write gave the quote its row. Sent as it stands it would create a
          // second quote, so it takes the identity the write just confirmed —
          // the quote's, not its lines', which the next response re-keys.
          const next: QuoteDraft | null = queued.current;
          queued.current = null;
          current =
            next && !next.id && confirmed.current?.id
              ? {
                  ...next,
                  id: confirmed.current.id,
                  number: confirmed.current.number,
                  jobId: confirmed.current.jobId,
                  customerId: confirmed.current.customerId,
                }
              : next;
        }
      } finally {
        inFlight.current = false;
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

  /**
   * Flush before the tab goes away.
   *
   * `visibilitychange` rather than `beforeunload`, because iOS Safari does not
   * reliably fire the latter — and a contractor backgrounding the app mid-quote
   * is the single most likely way this screen ever gets left.
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

/**
 * Takes the server's ids without taking the server's content.
 *
 * Nodes are matched **by position in the payload**, which is exactly how they
 * were sent: `toSavePayload` prunes empty rows and flattens the tree in
 * document order, so the nth row the server wrote back is the nth row that went
 * out. Matching on description or amount would re-key the wrong node the moment
 * two rows read the same, which on a quote with four identical 20A circuits is
 * immediately.
 *
 * The walk below has to prune in **exactly the same order and by exactly the
 * same rule** as `toSavePayload`, which is why it calls `flatten` on a pruned
 * copy rather than re-implementing the traversal — a second copy of that rule
 * is a second thing that can drift, and the symptom would be a line silently
 * adopting its neighbour's id.
 */
function adoptIdentity(live: QuoteDraft, server: QuoteDraft): QuoteDraft {
  const written = flatten(server.scope);

  // The same prune, walked in the same pre-order, so the nth row here is the
  // nth row the server wrote back.
  let cursor = 0;
  function adopt(nodes: ScopeNode[]): ScopeNode[] {
    return nodes.map((node) => {
      if (!persists(node)) return node;
      const id = written[cursor]?.node.id ?? node.id;
      cursor += 1;
      return {
        ...node,
        id,
        children: node.children.length ? adopt(node.children) : node.children,
      };
    });
  }

  return {
    ...live,
    id: server.id,
    number: server.number,
    jobId: server.jobId,
    customerId: server.customerId,
    status: server.status,
    scope: adopt(live.scope),
  };
}

/** `toSavePayload`'s prune rule, so the walk above stays in step with it. */
function persists(node: ScopeNode): boolean {
  if (node.children.some(persists)) return true;
  if (node.description.trim() !== "") return true;
  return node.sellPriceCents > 0;
}
