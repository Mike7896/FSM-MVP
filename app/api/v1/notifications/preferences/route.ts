import { requireCaller } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { listPreferences, setPreference } from "@/lib/notifications";
import { updateNotificationPreferenceSchema } from "@/lib/schemas";

/**
 * `/api/v1/notifications/preferences` — what reaches the caller, and on which
 * channel. Screen 44 · job CF2.
 *
 * **Per person, not per Office.** Settings is the app for whoever is signed in,
 * so no organization is resolved here: none is involved, and one admin muting
 * quote opens mutes them for nobody else.
 */

/** `GET` — every event, with the caller's choices and the defaults filled in. */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  return ok(await listPreferences(caller.userId));
});

/** `PATCH` — change one event's channels. Returns that event's row as it now stands. */
export const PATCH = handler(async (request) => {
  const caller = await requireCaller(request);
  const { kind, ...change } = await readJson(
    request,
    updateNotificationPreferenceSchema
  );
  return ok(await setPreference(caller.userId, kind, change));
});
