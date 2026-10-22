import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const path = request.nextUrl.pathname + request.nextUrl.search;

  if (!sessionCookie) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("callbackUrl", path);
    // Serve only the public sign-in page so link unfurlers receive safe metadata.
    // No protected layout or workspace query runs for this anonymous request.
    if (request.nextUrl.pathname.startsWith("/app")) {
      const response = NextResponse.rewrite(signInUrl);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    return NextResponse.redirect(signInUrl);
  }

  // Lets server layouts send people back here after a required step
  // (choosing a handle) without trusting a client-supplied target.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-lictory-path", path);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/app/:path*", "/welcome"],
};
