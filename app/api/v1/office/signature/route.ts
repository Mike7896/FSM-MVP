import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { noContent, ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { autoSignSchema, storedSignatureSchema } from "@/lib/schemas";
import {
  clearStoredSignature,
  saveStoredSignature,
  setAutoSign,
} from "@/lib/signing";

/**
 * `/api/v1/office/signature` — the business's signature on contracts.
 * Documents §5.
 *
 * Owners and admins only. This signature binds the business on every contract
 * generated from an approved quote, which is not a permission anybody meant a
 * technician on a phone to hold.
 */

/** `PUT` — adopt a signature, replacing any stored one. */
export const PUT = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, {
    roles: BILLING_ROLES,
  });
  const body = await readJson(request, storedSignatureSchema);

  return ok(await saveStoredSignature(organizationId, body));
});

/** `PATCH` — whether new contracts are signed as they're created. */
export const PATCH = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, {
    roles: BILLING_ROLES,
  });
  const { autoSign } = await readJson(request, autoSignSchema);

  return ok(await setAutoSign(organizationId, autoSign));
});

/** `DELETE` — take the signature off future contracts. Signed ones keep it. */
export const DELETE = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, {
    roles: BILLING_ROLES,
  });

  await clearStoredSignature(organizationId);
  return noContent();
});
