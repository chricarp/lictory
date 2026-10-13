/** A deployment must point to its corresponding source, including local changes. */
export function sourceCodeUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password)
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
