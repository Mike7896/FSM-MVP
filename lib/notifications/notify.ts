import "server-only";

import { after } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  memberships,
  notificationDeliveries,
  notifications,
} from "@/lib/db/schema";

import { compose, type NotificationEvent } from "./compose";
import { deliver } from "./deliver";
import { planDeliveries } from "./plan";
import { settingsFor, wantsChannel } from "./preferences";

/** The roles an Office's money and paperwork answer to. */
const TOLD_BY_ROLE = new Set(["owner", "admin"]);

/**
 * Tell the right people that something happened.
 *
 * **Never throws.** A homeowner's quote must open whether or not the
 * contractor's email goes out, and a Stripe webhook must be acknowledged
 * whether or not a notification was written — so a failure here is logged and
 * swallowed, never passed up into the thing that happened.
 *
 * Who hears about it: the Office's owners and admins, plus whoever sent the
 * document, minus whoever did the thing.
 *
 * One row per person, deduped — which is also their in-app notification, the
 * bell and the pop-up — then one delivery per channel that person wants:
 * email (now, or held for their daily summary) and texts (now, or after their
 * quiet hours). A push preference is saved and will be honored the day the
 * phone app can receive one; until then nothing pretends to send it.
 *
 * Returns how many people were newly told — zero for a repeat.
 */
export async function notify(
  event: NotificationEvent,
  options?: {
    /**
     * Off for the sweeps, which write many at once and leave the sending to the
     * delivery batch in the same cron run.
     */
    deliverNow?: boolean;
  }
): Promise<number> {
  try {
    const composed = await compose(event);
    if (!composed) return 0;

    const members = await db
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.organizationId, event.organizationId));

    // Only members are ever told — someone removed from the Office since
    // stops hearing about it — and some events are only for the people named.
    const alsoTo = new Set(composed.alsoTo);
    const audience = members
      .filter(
        (member) =>
          (composed.only
            ? alsoTo.has(member.userId)
            : TOLD_BY_ROLE.has(member.role) || alsoTo.has(member.userId)) &&
          member.userId !== event.actorUserId
      )
      .map((member) => member.userId);

    if (audience.length === 0) return 0;

    const written = await db
      .insert(notifications)
      .values(
        audience.map((userId) => ({
          organizationId: event.organizationId,
          userId,
          kind: event.kind,
          title: composed.title,
          body: composed.body,
          href: composed.href,
          dedupeKey: composed.dedupeKey,
        }))
      )
      .onConflictDoNothing({
        target: [notifications.userId, notifications.dedupeKey],
      })
      .returning({ id: notifications.id, userId: notifications.userId });

    if (written.length === 0) return 0;

    const people = written.map((row) => row.userId);
    const [byEmail, byText, settings] = await Promise.all([
      wantsChannel(people, event.kind, "email"),
      wantsChannel(people, event.kind, "sms"),
      settingsFor(people),
    ]);

    // Now, held for the summary, or waiting out quiet hours — see `plan`.
    const deliveries = planDeliveries({
      written,
      wantsEmail: byEmail,
      wantsText: byText,
      settings,
      now: new Date(),
    });

    const queued = deliveries.length
      ? await db
          .insert(notificationDeliveries)
          .values(deliveries)
          .onConflictDoNothing()
          .returning({ id: notificationDeliveries.id })
      : [];

    // `deliver` sends only what is due now — held summaries and quiet-hours
    // texts are left for the cron.
    if (options?.deliverNow !== false) {
      await deliver(queued.map((row) => row.id));
    }

    return written.length;
  } catch (error) {
    console.error(`[notifications] ${event.kind} didn't go out:`, error);
    return 0;
  }
}

/**
 * `notify`, after the response.
 *
 * What emitters call. The work that triggered the event — a page render, a
 * webhook acknowledgement, an acceptance — finishes first and never waits on a
 * recipient lookup or an email provider. Outside a request (a script) there is
 * no "after", so it runs straight away; `compose` re-reads the state either
 * way, so a write that never committed still tells nobody.
 */
export function notifyLater(event: NotificationEvent) {
  try {
    after(() => notify(event));
  } catch {
    void notify(event);
  }
}
