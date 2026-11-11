// Reading optional settings from the environment. Deployments forward unset
// variables as empty strings (compose's `${VAR:-}`), so an empty or
// whitespace-only value means "not set" and the caller's default applies.
// Use these helpers instead of `process.env.NAME ?? fallback`, which keeps
// the empty string.

export type Environment = Readonly<Record<string, string | undefined>>;

// The trimmed value, or undefined when the variable is unset or blank.
export function env(
  name: string,
  source: Environment = process.env,
): string | undefined {
  const value = source[name]?.trim();
  if (!value) return undefined;
  return value;
}

// Removes blank variables from the environment, so they are unset for code
// that reads process.env itself as well. Libraries do not share the rule
// above: the AI SDKs read their own variables when they load, and
// @ai-sdk/openai refuses a blank OPENAI_BASE_URL. Safe to call again.
export function unsetBlankVariables(
  target: Record<string, string | undefined> = process.env,
) {
  for (const [name, value] of Object.entries(target))
    if (value !== undefined && !value.trim()) delete target[name];
}

// A non-negative whole number, or undefined when unset or blank. A value that
// is set but not a whole number is a configuration error, not a default.
export function envInteger(
  name: string,
  source: Environment = process.env,
): number | undefined {
  const value = env(name, source);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value))
    throw new Error(`${name} must be a whole number, got "${value}".`);
  return Number(value);
}

const booleans = new Map([
  ["true", true],
  ["yes", true],
  ["1", true],
  ["false", false],
  ["no", false],
  ["0", false],
]);

// true/yes/1 or false/no/0 (any case), or undefined when unset or blank.
export function envBoolean(
  name: string,
  source: Environment = process.env,
): boolean | undefined {
  const value = env(name, source);
  if (value === undefined) return undefined;
  const parsed = booleans.get(value.toLowerCase());
  if (parsed === undefined)
    throw new Error(`${name} must be true or false, got "${value}".`);
  return parsed;
}
