import { z } from "zod";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { clientIp } from "@/lib/api/request";
import { ApiError, ok } from "@/lib/api/response";
import { issueDepositInvoice, loadDocument } from "@/lib/documents";
import { SigningError, signDocument } from "@/lib/signing";

/**
 * `POST /api/v1/documents/[id]/sign` — the in-app signing path.
 *
 * The contractor signing his own contract, from a session. The homeowner's path
 * is the same function behind a share token, because possession of an
 * unguessable link is her authentication and she will never have an account.
 *
 * **The audit fields are read off the request, never off the body.** A client
 * that could report its own IP, its own user agent or its own signing time
 * could forge the audit trail, and the audit trail is the entire product here —
 * so the schema below accepts a name, a mark and a consent flag, and nothing
 * else is trusted.
 */

const bodySchema = z.object({
  party: z.enum(["contractor", "customer"]),
  printedName: z.string().trim().min(1).max(120),
  consented: z.boolean(),
  mark: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("typed") }),
    z.object({
      kind: z.literal("drawn"),
      paths: z.array(z.string()).min(1).max(200),
    }),
  ]),
  organizationId: z.uuid().optional(),
});

export const POST = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const body = await readJson(request, bodySchema);

    const { organizationId } = await requireOrg(request, caller, {
      organizationId: body.organizationId,
      // Signing binds the business. A technician doing it from a phone on site
      // is not a permission anybody meant to grant.
      roles: ["owner", "admin"],
    });

    try {
      const target = await loadDocument(id, organizationId);
      if (target?.type === "change_order") throw new ApiError("invalid_request", "Send the change order from its editor and collect the customer's approval on its share link.");
      const { signature, document } = await signDocument({
        documentId: id,
        organizationId,
        party: body.party,
        printedName: body.printedName,
        mark: body.mark,
        consented: body.consented,
        authMethod: "account",
        signerEmail: caller.email,
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent"),
      });

      // The signature that completes a contract issues its deposit (Flow 2),
      // whichever party signed last. A failure there never costs the signature.
      if (document.type === "contract" && document.status === "signed") {
        await issueDepositInvoice({ organizationId, contractId: document.id }).catch(
          (error) => console.error("[sign] signed, but the deposit didn't issue:", error)
        );
      }

      return ok({
        signature,
        status: document.status,
        // The second signature freezes the contract from a database trigger,
        // and the page has to stop offering an edit button the moment it does.
        frozen: document.frozenAt !== null,
      });
    } catch (error) {
      if (error instanceof SigningError) {
        throw new ApiError(
          error.recoverable ? "invalid_request" : "conflict",
          error.message
        );
      }
      throw error;
    }
  }
);
