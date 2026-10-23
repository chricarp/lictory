// A hint, not a credential: the application sets it while someone is signed
// in so the public website (another origin on the same site) can offer "Open
// workspace" instead of sign-up and sign-in. It carries no identity and grants
// nothing; the website never sees the session, and a stale hint only means the
// application shows its sign-in page. Same pattern as GitHub's `logged_in`.

export const SIGNED_IN_HINT = "lictory_signed_in";

// The application refreshes it on every visit; an abandoned session outlives
// it by at most this long.
const maxAgeSeconds = 7 * 24 * 60 * 60;

/**
 * The `Domain` attribute that makes the hint visible to both hosts: none when
 * they are the same host (cookies ignore ports), their shared parent domain
 * otherwise (`app.lictory.com` and `lictory.com` share `lictory.com`), or
 * `null` when they share no domain the browser would accept.
 */
export function signedInHintDomain(
  appHost: string,
  siteHost: string,
): string | undefined | null {
  if (appHost === siteHost) return undefined;
  const app = appHost.split(".").reverse();
  const site = siteHost.split(".").reverse();
  const shared: string[] = [];
  for (let index = 0; index < Math.min(app.length, site.length); index++) {
    if (app[index] !== site[index]) break;
    shared.unshift(app[index]!);
  }
  if (shared.length < 2 || shared.every((label) => /^\d+$/.test(label)))
    return null;
  return shared.join(".");
}

/** A `Set-Cookie`-style string for `document.cookie`, or null if it cannot be shared. */
export function signedInHintCookie(
  signedIn: boolean,
  app: URL,
  site: URL,
): string | null {
  const domain = signedInHintDomain(app.hostname, site.hostname);
  if (domain === null) return null;
  return [
    `${SIGNED_IN_HINT}=${signedIn ? "1" : ""}`,
    "Path=/",
    `Max-Age=${signedIn ? maxAgeSeconds : 0}`,
    "SameSite=Lax",
    ...(domain ? [`Domain=${domain}`] : []),
    ...(app.protocol === "https:" ? ["Secure"] : []),
  ].join("; ");
}

/** Whether a `document.cookie` string carries the hint. */
export function hasSignedInHint(cookies: string): boolean {
  return cookies
    .split(";")
    .some((cookie) => cookie.trim() === `${SIGNED_IN_HINT}=1`);
}
