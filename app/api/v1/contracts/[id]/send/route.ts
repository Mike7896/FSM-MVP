import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { sendContract } from "@/lib/documents";
import { sendContractSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/contracts/[id]/send` — a copy of the contract goes out.
 *
 * Who it may reach, which link it carries, the delivery and the record of it
 * are all `sendContract`'s. This endpoint authenticates and hands over.
 */
export const POST = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);
    const input = await readJson(request, sendContractSchema);

    return ok(
      await sendContract({
        organizationId,
        contractId: id,
        sender: { userId: caller.userId, email: caller.email },
        input,
      })
    );
  }
);
