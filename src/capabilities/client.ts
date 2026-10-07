// Browser helper for the generic capability route.
export class CapabilityRequestError extends Error {
  constructor(
    readonly category: string,
    message: string,
  ) {
    super(message);
  }
}

export async function callCapability<T>(
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(
    `/api/capabilities/${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const json = (await response.json().catch(() => null)) as
    (T & { error?: { category?: string; message?: string } }) | null;
  if (!response.ok)
    throw new CapabilityRequestError(
      json?.error?.category ?? "server",
      json?.error?.message ?? "The request failed. Try again.",
    );
  return json as T;
}
