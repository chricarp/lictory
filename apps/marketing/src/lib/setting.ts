/**
 * A trimmed configuration value; empty and whitespace-only count as unset.
 * Image builds pass unset build arguments as empty strings.
 */
export function setting(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}
