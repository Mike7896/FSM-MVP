import { z } from "zod";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import {
  createDashboardLink,
  getConnectedAccount,
} from "@/lib/stripe/connect";

/**
 * A door into the contractor's own Express dashboard.
 *
 * His balance, his payout schedule, the bank account money lands in, and every
 * dispute Stripe is handling on his behalf. **We do not rebuild any of it** —
 * rebuilding it would mean holding a second copy of numbers Stripe owns, and
 * the first time the two disagreed it would be about somebody's money.
 *
 * The link is short-lived and single-use, so it is minted per request.
 */

const bodySchema = z.object({
  organizationId: z.uuid().optional(),
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const body = await readJson(request, bodySchema);

  const { organizationId } = await requireOrg(request, caller, {
    organizationId: body.organizationId,
    roles: ["owner", "admin"],
  });

  const account = await getConnectedAccount(organizationId);
  if (!account) {
    throw new ApiError(
      "not_found",
      "This shop hasn't set up payments yet. Start that first."
    );
  }

  // Stripe rejects a login link for an account that has not completed
  // onboarding, and its error names their internals. Say the useful thing.
  if (!account.detailsSubmitted) {
    throw new ApiError(
      "conflict",
      "Finish setting up payments first — Stripe needs your details before " +
        "there's a dashboard to open."
    );
  }

  return ok({ url: await createDashboardLink(account) });
});
