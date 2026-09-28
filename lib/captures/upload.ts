/**
 * Putting one photo on a job, from the browser.
 *
 * **The file goes straight to Storage and the row is written after it lands.**
 * Photos run to megabytes each, so routing them through the app server buys
 * nothing but a timeout — and a row written first is a thumbnail that never
 * loads. Shared by the quote editor's capture intake and the phase-complete
 * flow, so there is one way a photo reaches a job.
 */
export async function uploadJobPhoto(
  jobId: string,
  file: File
): Promise<{ id: string }> {
  // 1 — somewhere to put it. The path is assembled on the server from the
  // organization it proved, never from anything sent by this client.
  const slot = await fetch(`/api/v1/jobs/${jobId}/captures/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name }),
  });

  const slotBody = (await slot.json().catch(() => null)) as {
    data?: { signedUrl: string; path: string };
    error?: { message?: string };
  } | null;

  if (!slot.ok || !slotBody?.data) {
    throw new Error(slotBody?.error?.message ?? "Couldn't start the upload.");
  }

  // 2 — the bytes, straight to Storage.
  const put = await fetch(slotBody.data.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });

  if (!put.ok) throw new Error(`${file.name} didn't upload.`);

  // 3 — and only now the row.
  const row = await fetch(`/api/v1/jobs/${jobId}/captures`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "photo",
      storagePath: slotBody.data.path,
      body: file.name.replace(/\.[^.]+$/, ""),
    }),
  });

  const rowBody = (await row.json().catch(() => null)) as {
    data?: { id: string };
  } | null;

  if (!row.ok || !rowBody?.data) {
    throw new Error(`${file.name} uploaded but wasn't recorded.`);
  }

  return { id: rowBody.data.id };
}
