import { requireCaller } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { getSettings, saveSettings } from "@/lib/notifications";
import { notificationSettingsSchema } from "@/lib/schemas";
import { smsConfigured } from "@/lib/sms/send";

/**
 * `/api/v1/notifications/settings` — how the caller is reached: where texts
 * go, how often email comes, quiet hours, pop-ups. Per person, like the
 * preferences, so no Office is involved. `texts` says whether this server can
 * send a text at all.
 */

export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  return ok({ ...(await getSettings(caller.userId)), texts: smsConfigured() });
});

export const PATCH = handler(async (request) => {
  const caller = await requireCaller(request);
  const change = await readJson(request, notificationSettingsSchema);
  return ok({ ...(await saveSettings(caller.userId, change)), texts: smsConfigured() });
});
