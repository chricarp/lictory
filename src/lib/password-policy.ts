/** Password rules shared by the auth server and the password fields. */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 64;

const WHITESPACE = /\s/;

export function containsWhitespace(value: string): boolean {
  return WHITESPACE.test(value);
}

export function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}
