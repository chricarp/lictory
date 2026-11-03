import { signedInHintCookie } from "@lictory/core/lib/signed-in-hint";
import { publicConfig } from "@lictory/platform/lib/public-config";

// The operator's public website (SITE_URL): legal pages and the product home.
// The app host links there; it never serves them itself. Optional: without a
// website the app shows no links to it.
export const siteUrl = publicConfig.siteUrl;

/** A page of the website, or null when this installation has none. */
export const siteLink = (path: string) =>
  siteUrl === null ? null : `${siteUrl}${path}`;

// Lets the public site offer "Open workspace" to someone signed in here.
export function rememberSignedIn(signedIn: boolean) {
  if (siteUrl === null) return;
  const cookie = signedInHintCookie(
    signedIn,
    new URL(window.location.href),
    new URL(siteUrl),
  );
  if (cookie) document.cookie = cookie;
}
