import type { NextRequest } from "next/server";

import { analyticsRelayPath, relayTarget } from "@lictory/core/lib/analytics/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// First-party relay for the PostHog browser SDK. It forwards only what PostHog
// needs: Lictory cookies and auth headers never leave this origin, and PostHog
// cookies are never set on it. The visitor's IP is forwarded explicitly because
// PostHog's cookieless mode hashes IP + user agent; without it every visitor
// would collapse into the relay's server address. `origin` is Lictory's own
// origin; PostHog's flags service uses it as the site host in that hash and
// rejects cookieless flag requests without it.
const forwardedRequestHeaders = [
  "accept",
  "accept-language",
  "content-encoding",
  "content-type",
  "origin",
  "user-agent",
];
const droppedResponseHeaders = [
  "set-cookie",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
];

function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  return (forwarded ?? request.headers.get("x-real-ip") ?? "").trim();
}

async function relay(request: NextRequest) {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!host || !process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
    return new Response(null, { status: 404 });
  }
  const target = relayTarget(
    request.nextUrl.pathname.slice(analyticsRelayPath.length),
    request.nextUrl.search,
    host,
  );
  if (!target) return new Response(null, { status: 404 });

  const headers = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const ip = clientIp(request);
  if (ip) headers.set("x-forwarded-for", ip);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const name of droppedResponseHeaders) responseHeaders.delete(name);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    // Analytics delivery is best effort; the SDK retries on its own.
    return new Response(null, { status: 502 });
  }
}

export { relay as GET, relay as POST, relay as HEAD };
