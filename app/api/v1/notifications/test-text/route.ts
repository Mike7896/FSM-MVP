import { requireCaller } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { getSettings } from "@/lib/notifications";
import { formatPhone } from "@/lib/sms/phone";
import { SmsNotConfiguredError, sendSms } from "@/lib/sms/send";

/**
 * `POST /api/v1/notifications/test-text` — one text to the caller's own saved
 * number, so they know it arrives before a real one has to.
 *
 * Only ever to the number on their own settings, never to one in the body: a
 * button that texts any number it's given is a button for texting strangers.
 */
export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { smsPhone } = await getSettings(caller.userId);

  if (!smsPhone) {
    throw new ApiError("invalid_request", "Save a mobile number first.");
  }

  try {
    await sendSms({
      to: smsPhone,
      body: "ServiceClerk: This is your test text. Notifications you turn on for texts will arrive like this.",
    });
  } catch (error) {
    throw new ApiError(
      error instanceof SmsNotConfiguredError ? "invalid_request" : "internal",
      error instanceof Error ? error.message : "The text didn't go out."
    );
  }

  return ok({ to: formatPhone(smsPhone) });
});
