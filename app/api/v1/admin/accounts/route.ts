import { requireAdminCaller } from "@/lib/admin/access";
import { createTestAccount, listAccounts } from "@/lib/admin/accounts";
import { handler, readJson, readQuery } from "@/lib/api/handler";
import { created, ok } from "@/lib/api/response";
import { createTestAccountSchema, listAccountsSchema } from "@/lib/schemas";

/**
 * `GET /api/v1/admin/accounts?q&filter` — every account, newest first.
 * `POST /api/v1/admin/accounts` — make a test account. The password comes
 * back in this one answer and is never readable again.
 */
export const GET = handler(async (request) => {
  await requireAdminCaller(request);
  const { q, filter } = readQuery(request, listAccountsSchema);
  return ok(await listAccounts({ q, filter }));
});

export const POST = handler(async (request) => {
  const admin = await requireAdminCaller(request);
  const body = await readJson(request, createTestAccountSchema);
  const account = await createTestAccount(admin, body);
  return created(account, `/api/v1/admin/accounts/${account.userId}`);
});
