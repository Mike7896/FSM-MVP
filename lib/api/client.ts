/** Read the API envelope and keep actionable errors on the form. */
export async function apiJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message ?? "That didn't save. Please try again.");
  return result.data as T;
}
