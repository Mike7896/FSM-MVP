import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Supabase Storage wrappers.
 *
 * Object paths are always `<organizationId>/<...>` so a single storage RLS
 * policy ("first path segment must be an org you belong to") covers every
 * bucket. Callers must pass an organization id that came from the DAL, never
 * one taken straight from user input.
 */

export const BUCKETS = {
  /** Private. Photos attached to work orders. */
  jobAttachments: "job-attachments",
  /** Public. Profile images. */
  avatars: "avatars",
  /**
   * Public. The business's logo — it sits on documents a customer opens with
   * no account, so it has to load with no signature. Paths start with the
   * organization id, like every other bucket.
   */
  logos: "logos",
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

export function jobAttachmentPath(
  organizationId: string,
  jobId: string,
  fileName: string
) {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${organizationId}/${jobId}/${crypto.randomUUID()}-${safe}`;
}

/**
 * Creates a short-lived upload URL so the browser can PUT the file straight to
 * Storage. Keeps large uploads out of the Next.js server entirely.
 */
export async function createSignedUploadUrl(
  bucket: BucketName,
  path: string
) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);

  if (error) throw error;
  return data; // { signedUrl, token, path }
}

/** Time-limited read URL for a private object. */
export async function createSignedDownloadUrl(
  bucket: BucketName,
  path: string,
  expiresInSeconds = 60 * 60
) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);

  if (error) throw error;
  return data.signedUrl;
}

/** Public buckets only - `avatars`. */
export async function getPublicUrl(bucket: BucketName, path: string) {
  const supabase = await createClient();
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function removeObjects(bucket: BucketName, paths: string[]) {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw error;
}
