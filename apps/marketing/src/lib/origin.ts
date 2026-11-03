/** An origin from configuration; an empty variable counts as unset. */
export function configuredOrigin(value: string | undefined, fallback: string) {
  return new URL(value === undefined || value === "" ? fallback : value).origin;
}
