import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, created, ok } from "@/lib/api/response";
import { createSupportRequestSchema } from "@/lib/schemas";
import {
  createSupportRequest,
  HOURLY_LIMIT,
  listSupportRequests,
  sentInLastHour,
} from "@/lib/support";

/**
 * `GET /api/v1/support` — what I've sent.
 * `POST /api/v1/support` — send a problem, an idea, or a request for help.
 *
 * The answer comes back by email to the sender's sign-in address; that's the
 * address the request is kept with, so nobody can ask for a reply to go
 * somewhere else in their name.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  return ok(await listSupportRequests(caller.userId));
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const body = await readJson(request, createSupportRequestSchema);

  if ((await sentInLastHour(caller.userId)) >= HOURLY_LIMIT) {
    throw new ApiError(
      "rate_limited",
      "That's a lot in one hour — we've got the others. Try again in a little while."
    );
  }

  // The shop it's about, when they're in one. Someone mid-setup still gets heard.
  const organizationId = await requireOrg(request, caller)
    .then((org) => org.organizationId)
    .catch(() => null);

  const saved = await createSupportRequest({
    organizationId,
    userId: caller.userId,
    replyTo: caller.email,
    userAgent: request.headers.get("user-agent"),
    request: body,
  });
  return created(saved, `/api/v1/support/${saved.id}`);
});
