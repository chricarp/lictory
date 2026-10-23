import { signedInHintCookie } from "@lictory/core/lib/signed-in-hint";

// The public site (lictory.com): legal pages and the product home. The app
// host links there; it never serves them itself.
const configured = import.meta.env.VITE_SITE_URL?.trim() ?? "";
export const siteUrl = (
  configured === "" ? "https://lictory.com" : configured
).replace(/\/+$/, "");
export const siteLink = (path: string) => `${siteUrl}${path}`;

// Lets the public site offer "Open workspace" to someone signed in here.
export function rememberSignedIn(signedIn: boolean) {
  const cookie = signedInHintCookie(
    signedIn,
    new URL(window.location.href),
    new URL(siteUrl),
  );
  if (cookie) document.cookie = cookie;
}
