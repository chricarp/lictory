import { isLoopbackHost, isSafeExternalUrl } from "./urls";

// What happens when a server's page navigates its top-level frame or opens a
// window. Only configured server origins load in the app; everything else
// opens in the default browser. The one exception is signing in with a
// company identity provider: an OAuth or OpenID Connect authorization request
// that returns to this server (its `redirect_uri` is on the server's origin)
// loads in the server's view, and so do the identity provider's own pages
// until the flow comes back to the server or ten minutes pass. That keeps
// the sign-in cookie in the server's session instead of the browser's. Those
// pages never receive the desktop bridge (the preload checks the origin).

export type NavigationDecision =
  | { kind: "allow" }
  // Belongs to another configured server: show it in that server's view.
  | { kind: "switch"; serverId: string; url: string }
  | { kind: "external"; url: string }
  | { kind: "block" };

export type NavigationContext = {
  serverOrigin: string;
  servers: readonly { id: string; origin: string }[];
  // While an identity provider sign-in is in progress in this view.
  signInUntil: number | null;
  now: number;
};

export const SIGN_IN_WINDOW_MS = 10 * 60_000;

function returnsTo(url: URL, origin: string) {
  const target = url.searchParams.get("redirect_uri");
  if (!target) return false;
  try {
    return new URL(target).origin === origin;
  } catch {
    return false;
  }
}

function isWebUrl(url: URL) {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && isLoopbackHost(url.hostname))
  );
}

export function decideNavigation(
  target: string,
  context: NavigationContext,
): { decision: NavigationDecision; signInUntil: number | null } {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { decision: { kind: "block" }, signInUntil: context.signInUntil };
  }
  const signingIn =
    context.signInUntil !== null && context.now < context.signInUntil;
  if (url.origin === context.serverOrigin)
    // Back on the server: a sign-in flow, if any, is over.
    return { decision: { kind: "allow" }, signInUntil: null };
  const other = context.servers.find(
    (s) => s.origin === url.origin && s.origin !== context.serverOrigin,
  );
  if (other && !signingIn)
    return {
      decision: { kind: "switch", serverId: other.id, url: url.href },
      signInUntil: null,
    };
  if (isWebUrl(url) && !url.username && !url.password) {
    if (returnsTo(url, context.serverOrigin))
      return {
        decision: { kind: "allow" },
        signInUntil: context.now + SIGN_IN_WINDOW_MS,
      };
    if (signingIn)
      return { decision: { kind: "allow" }, signInUntil: context.signInUntil };
  }
  if (isSafeExternalUrl(url.href))
    return {
      decision: { kind: "external", url: url.href },
      signInUntil: signingIn ? context.signInUntil : null,
    };
  return {
    decision: { kind: "block" },
    signInUntil: signingIn ? context.signInUntil : null,
  };
}

// window.open and target=_blank never create a window in the app: a link on
// the same server opens in its view, a link to another server in that
// server's view, anything else in the browser. Sign-in flows run in the
// server's view, never in a popup.
export function decideWindowOpen(
  target: string,
  context: Omit<NavigationContext, "signInUntil" | "now">,
): NavigationDecision {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { kind: "block" };
  }
  if (url.origin === context.serverOrigin) return { kind: "allow" };
  const other = context.servers.find((s) => s.origin === url.origin);
  if (other) return { kind: "switch", serverId: other.id, url: url.href };
  return isSafeExternalUrl(url.href)
    ? { kind: "external", url: url.href }
    : { kind: "block" };
}
