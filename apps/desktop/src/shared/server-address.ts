import { describeNetworkError } from "./net-errors";
import { isLoopbackHost } from "./urls";

// Turning what a person types into a server origin, and checking that the
// origin answers like a Lictory server before it is added.

export type AddressResult =
  | { ok: true; origin: string; insecure: boolean }
  | { ok: false; error: string };

const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i;

// Accepts `lictory.example.com`, `https://lictory.example.com/acme/inbox`,
// `localhost:3000` and the like. Lictory is served from the root of its
// origin, so a path, query or fragment is dropped. Without a scheme the
// address is HTTPS, except on this computer.
export function parseServerAddress(input: string): AddressResult {
  const value = input.trim();
  if (!value)
    return {
      ok: false,
      error: "Enter your Lictory server's address.",
    };
  if (/\s/.test(value))
    return { ok: false, error: "A server address cannot contain spaces." };
  let candidate = value;
  if (!hasScheme.test(candidate)) {
    const host = candidate.split(/[/?#]/, 1)[0] ?? "";
    const hostname = host.replace(/:\d+$/, "");
    candidate = `${isLoopbackHost(hostname) ? "http" : "https"}://${candidate}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: `“${value}” is not a valid server address.` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return {
      ok: false,
      // http:// is accepted too (on this computer, or with a warning on a
      // network), so the message does not say https:// only.
      error: `A Lictory server address starts with https:// (or http://), not ${url.protocol}//.`,
    };
  if (url.username || url.password)
    return {
      ok: false,
      error: "Remove the user name and password from the address.",
    };
  if (!url.hostname)
    return { ok: false, error: `“${value}” is not a valid server address.` };
  return {
    ok: true,
    origin: url.origin,
    insecure: url.protocol === "http:" && !isLoopbackHost(url.hostname),
  };
}

// The endpoint every Lictory server answers without a session: the web app
// reads it at boot (apps/api: GET /api/session).
export const PROBE_PATH = "/api/session";

type ProbeResponse = {
  status: number;
  url: string;
  contentType: string | null;
  body: unknown;
};

export type ProbeResult =
  | { ok: true; origin: string; insecure: boolean }
  // `detail`: the technical cause (a network error code), shown apart.
  | { ok: false; error: string; detail?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Whether a response to GET <origin>/api/session came from Lictory. The
// redirect target counts (http to https, an old domain to a new one), never
// a downgrade from HTTPS to plain HTTP.
export function readProbe(requested: string, response: ProbeResponse) {
  const host = new URL(requested).host;
  let final: URL;
  try {
    final = new URL(response.url || requested);
  } catch {
    final = new URL(requested);
  }
  if (new URL(requested).protocol === "https:" && final.protocol !== "https:")
    return {
      ok: false,
      error: `${host} redirected to an unencrypted address, which Lictory does not follow.`,
    } satisfies ProbeResult;
  const notLictory = {
    ok: false,
    error: `${host} answered, but not like a Lictory server. Check the address with your administrator.`,
  } satisfies ProbeResult;
  if (response.status >= 500)
    return {
      ok: false,
      error: `${host} is not working right now (HTTP ${response.status}). Try again in a moment.`,
    } satisfies ProbeResult;
  if (response.status !== 200) return notLictory;
  if (!response.contentType?.toLowerCase().includes("application/json"))
    return notLictory;
  const body = response.body;
  if (
    !isRecord(body) ||
    !("user" in body) ||
    !isRecord(body.signIn) ||
    typeof body.signIn.password !== "boolean" ||
    !isRecord(body.providers)
  )
    return notLictory;
  return {
    ok: true,
    origin: final.origin,
    insecure: final.protocol === "http:" && !isLoopbackHost(final.hostname),
  } satisfies ProbeResult;
}

export type ProbeFetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

// Asks `origin` whether it is a Lictory server. The fetch carries no cookies
// (the main process passes one bound to an empty, in-memory session).
export async function probeServer(
  origin: string,
  fetch: ProbeFetch,
  timeoutMs = 10_000,
): Promise<ProbeResult> {
  const host = new URL(origin).host;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin}${PROBE_PATH}`, {
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type");
    const body: unknown = contentType?.includes("json")
      ? await response.json().catch(() => null)
      : null;
    return readProbe(origin, {
      status: response.status,
      url: response.url,
      contentType,
      body,
    });
  } catch (error) {
    if (controller.signal.aborted)
      return {
        ok: false,
        error: `${host} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
      };
    const reason = error instanceof Error ? error.message : String(error);
    const problem = describeNetworkError(reason, host);
    return {
      ok: false,
      error: `${problem.summary} ${problem.next}`,
      detail: problem.code ?? reason,
    };
  } finally {
    clearTimeout(timer);
  }
}
