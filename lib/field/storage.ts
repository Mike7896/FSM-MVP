import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { BUCKETS } from "@/lib/supabase/storage";
import { DomainError } from "@/lib/errors";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, isAttachmentPath } from "@/lib/schemas/receipt";

// Call only after proving job ownership or possession of a live reply token.
export async function attachmentSlot(prefix: string, fileName: string) {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${prefix}/${crypto.randomUUID()}-${safe}`;
  const { data, error } = await createAdminClient().storage.from(BUCKETS.jobAttachments).createSignedUploadUrl(path);
  if (error) throw error;
  return { path, signedUrl: data.signedUrl };
}
export async function verifyAttachment(path: string, prefix: string, photosOnly = false) {
  if (!isAttachmentPath(path, prefix)) throw new DomainError("That attachment doesn't belong to this record.", "invalid");
  const { data, error } = await createAdminClient().storage.from(BUCKETS.jobAttachments).info(path);
  if (error || !data) throw new DomainError("The attachment hasn't uploaded. Try uploading it again.", "invalid");
  const metadata = data.metadata as { size?: number; mimetype?: string } | undefined;
  const mime = data.contentType ?? metadata?.mimetype ?? "";
  const size = data.size ?? metadata?.size;
  if (!size || size > MAX_ATTACHMENT_BYTES || !ATTACHMENT_TYPES.includes(mime) || (photosOnly && !mime.startsWith("image/"))) {
    throw new DomainError("Use a photo or PDF no larger than 10 MB.", "invalid");
  }
}
export async function attachmentUrl(path: string, prefix: string) {
  if (!isAttachmentPath(path, prefix)) return null;
  const { data, error } = await createAdminClient().storage.from(BUCKETS.jobAttachments).createSignedUrl(path, 900);
  if (error) return null;
  return data.signedUrl;
}
