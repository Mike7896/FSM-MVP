import type Stripe from "stripe";
import type { MembershipConfig } from "./changes";

/** Persisted before touching Stripe; a retry never reconstructs the purchase. */
export type PlanTransition = {
  id: string;
  subscriptionId: string;
  target: MembershipConfig;
  immediate: MembershipConfig | null;
  scheduled: MembershipConfig | null;
  previous: MembershipConfig | null;
  previousCancel: boolean;
  founding: boolean;
  prorationDate: number;
  periodEnd: number;
  update: Stripe.SubscriptionUpdateParams;
  phase: "prepared" | "updating" | "waiting" | "scheduling" | "complete" | "aborted";
  invoiceUrl: string | null;
};

export type TransitionSnapshot = {
  config: MembershipConfig;
  pending: boolean;
  ended: boolean;
  scheduleId: string | null;
  invoiceUrl: string | null;
};

export type TransitionPorts = {
  save: (state: PlanTransition) => Promise<void>;
  read: () => Promise<TransitionSnapshot>;
  release: (id: string) => Promise<void>;
  update: (params: Stripe.SubscriptionUpdateParams, key: string) => Promise<void>;
  schedule: (config: MembershipConfig, key: string) => Promise<void>;
  cancelAtEnd: (cancel: boolean) => Promise<void>;
  now: () => number;
};

export function sameConfig(a: MembershipConfig, b: MembershipConfig) {
  return a.tier === b.tier && a.interval === b.interval && [...a.packs].sort().join() === [...b.packs].sort().join();
}

/** Durable saga. Safe to resume after any external call or checkpoint fails. */
export async function runPlanTransition(initial: PlanTransition, ports: TransitionPorts): Promise<PlanTransition> {
  let state = initial;
  const save = async (phase: PlanTransition["phase"], extra: Partial<PlanTransition> = {}) => {
    const next = { ...state, ...extra, phase };
    await ports.save(next);
    state = next;
  };
  const restore = async () => {
    if ((state.previous || state.previousCancel) && ports.now() >= state.periodEnd) {
      throw new Error("A membership change needs support review: its previous renewal boundary has passed.");
    }
    if (state.previous) await ports.schedule(state.previous, `${state.id}:restore`);
    else if (state.previousCancel) await ports.cancelAtEnd(true);
  };
  if (state.phase === "complete" || state.phase === "aborted") return state;
  let snapshot = await ports.read();
  if (snapshot.ended) { await save("aborted"); return state; }

  if (state.phase === "prepared") {
    await save(state.immediate ? "updating" : "scheduling");
  }
  if (state.phase === "updating") {
    if (!snapshot.pending && !sameConfig(snapshot.config, state.immediate!)) {
      // Stripe retains idempotency keys for at least 24h. Never reissue an
      // uncertain charge after that window, or after the quoted period ends.
      if (ports.now() >= Math.min(state.periodEnd, state.prorationDate + 23 * 3600)) {
        await restore();
        await save("aborted");
        return state;
      }
      try {
        if (snapshot.scheduleId) await ports.release(snapshot.scheduleId);
        await ports.update(state.update, `${state.id}:upgrade`);
      } catch (error) {
        // A timeout may have charged successfully. Read before restoring;
        // if that read also fails the durable instruction remains retryable.
        snapshot = await ports.read();
        if (!snapshot.pending && !sameConfig(snapshot.config, state.immediate!)) {
          await restore();
          if (error && typeof error === "object" && "type" in error && error.type === "StripeCardError") {
            await save("aborted");
          }
        }
        throw error;
      }
      snapshot = await ports.read();
    }
    await save(snapshot.pending ? "waiting" : "scheduling", { invoiceUrl: snapshot.invoiceUrl });
  }
  if (state.phase === "waiting") {
    snapshot = await ports.read();
    if (snapshot.pending) {
      // Stripe forbids editing schedules while a pending update exists.
      // Requests with an existing renewal choice use error_if_incomplete;
      // ordinary purchases retain their new renewal intent in this journal.
      return state;
    }
    if (!sameConfig(snapshot.config, state.immediate!)) {
      await restore();
      await save("aborted");
      return state;
    }
    await save("scheduling");
  }
  if (state.phase === "scheduling") {
    snapshot = await ports.read();
    if (state.scheduled) {
      // Don't silently move an overdue promised change to another renewal.
      if (ports.now() >= state.periodEnd) {
        throw new Error("A membership change needs support review: its renewal boundary has passed.");
      }
      await ports.schedule(state.scheduled, `${state.id}:target`);
    } else if (snapshot.scheduleId) {
      await ports.release(snapshot.scheduleId);
    }
    await ports.cancelAtEnd(false);
    await save("complete");
  }
  return state;
}
