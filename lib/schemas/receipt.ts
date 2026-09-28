import { z } from "zod";
export const receiptSchema = z.object({
  id: z.uuid(), vendor: z.string().trim().max(200),
  amountCents: z.number().int().positive().max(2147483647),
  description: z.string().trim().max(2000), purchasedOn: z.iso.date(),
  storagePath: z.string().max(500).nullable(),
});
export const attachmentUploadSchema = z.object({ fileName: z.string().trim().min(1).max(180) });
/** Per file — Billing §2.2. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
export function isAttachmentPath(path: string, prefix: string) {
  return path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes("/") &&
    !path.includes("..") && !path.includes("\\") && !path.includes("%");
}
