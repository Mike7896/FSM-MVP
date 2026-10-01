/** "1.2 GB", "340 MB" — client-safe, shared by the server and the usage card. */
export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${Number((bytes / 1024 ** 3).toFixed(1))} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} KB`;
}
