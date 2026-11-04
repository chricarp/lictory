import { test, type Page } from "@playwright/test";

// Better Auth rate limits each endpoint per client address (sign-in: 3 per
// 10 s), and the whole suite runs from one machine. Whether a test tripped a
// limit used to depend on how many requests the tests just before it made, so
// every browser profile that signs in gets an address of its own.
// scripts/edge-proxy.ts forwards the claimed address like a production edge.
//
// Addresses come from 198.18.0.0/15, reserved for benchmarking, and are unique
// per worker (4,096 per worker before reuse, minutes apart).
let next = 0;

export function clientAddress(): string {
  const id = (test.info().workerIndex % 32) * 4096 + (next++ % 4096);
  return `198.${18 + (id >> 16)}.${(id >> 8) & 255}.${id & 255}`;
}

const authRequests = "**/api/auth/**";

// Sends this page's authentication requests from its own address without
// replacing the context's other extra headers. Returns a function that stops.
export async function useClientAddress(
  page: Page,
  address = clientAddress(),
): Promise<() => Promise<void>> {
  // fallback, not continue: other handlers a test installs still apply.
  const handler = (route: Parameters<Parameters<Page["route"]>[1]>[0]) =>
    route.fallback({
      headers: { ...route.request().headers(), "x-forwarded-for": address },
    });
  await page.route(authRequests, handler);
  return () => page.unroute(authRequests, handler);
}
