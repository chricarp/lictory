import {
  RUNNER_API,
  type Assignment,
  type MachineReport,
  type SessionInput,
  type WorkspaceResponse,
} from "@lictory/core/factory/protocol";
import { RUNNER_VERSION } from "@lictory/runner/config";

// The runner's side of the protocol: plain HTTPS requests from this machine
// to the server, never the other way round.

export class ProtocolError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly kind?: string,
    readonly acked?: number,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
  // The lease (or the credential) is gone: stop, do not retry.
  get fatal() {
    return (
      this.kind === "lease_lost" ||
      this.kind === "revoked" ||
      this.status === 401
    );
  }
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

// The server could not be reached at all (no HTTP answer), in words that
// say which address and what to check. Transient: callers retry it.
export class NetworkError extends Error {
  constructor(
    readonly url: string,
    readonly code: string | undefined,
    cause: unknown,
  ) {
    super(describeNetworkError(url, code, cause));
    this.name = "NetworkError";
  }
}

const TLS_CODES =
  /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ALTNAME|TLS|SSL|HANDSHAKE/i;

export function describeNetworkError(
  url: string,
  code: string | undefined,
  cause: unknown,
) {
  let origin = url;
  let host = url;
  try {
    ({ origin, hostname: host } = new URL(url));
  } catch {
    // Not a URL: name it as given.
  }
  switch (code) {
    case "ConnectionRefused":
    case "ECONNREFUSED":
      return `Could not connect to ${origin}: nothing accepted the connection. Check the address and port, and that the server is running.`;
    case "ENOTFOUND":
    case "EAI_NONAME":
    case "EAI_AGAIN":
    case "DNSException":
      return `Could not find ${host}: the name does not resolve. Check the address (--url) and this machine's DNS.`;
    case "ETIMEDOUT":
    case "ConnectionTimeout":
    case "TimeoutError":
      return `${origin} did not answer in time. Check that outbound HTTPS to it is allowed (proxy, firewall).`;
    case "ECONNRESET":
    case "ConnectionClosed":
      return `${origin} closed the connection. Check proxies between this machine and the server, then try again.`;
  }
  if (code && TLS_CODES.test(code))
    return `${origin} presented a TLS certificate this machine does not trust (${code}). Use the server's public address, or trust its certificate authority with NODE_EXTRA_CA_CERTS=<ca.pem>.`;
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `Could not reach ${origin}: ${detail}${code && !detail.includes(code) ? ` (${code})` : ""}. Check the address and this machine's network.`;
}

const userAgent = `lictory-runner/${RUNNER_VERSION} (${process.platform}; ${process.arch})`;

export class RunnerClient {
  constructor(
    readonly url: string,
    private readonly credential: string | null,
  ) {}

  private endpoint(path: string) {
    return `${this.url.replace(/\/$/, "")}${RUNNER_API}${path}`;
  }

  async raw(path: string, body: unknown, signal?: AbortSignal) {
    const response = await this.fetch(path, body, signal);
    if (!response.ok) {
      const json = (await response.json().catch(() => null)) as {
        error?: { message?: string; kind?: string; acked?: number };
      } | null;
      throw new ProtocolError(
        response.status,
        json?.error?.message ??
          (response.status === 404
            ? `${this.url} has no Lictory runner API (HTTP 404). Check that --url is the address you open Lictory at.`
            : `${this.url} answered HTTP ${response.status} without saying why. If a proxy sits in front of Lictory, check its logs.`),
        json?.error?.kind,
        json?.error?.acked,
      );
    }
    return response;
  }

  private async fetch(path: string, body: unknown, signal?: AbortSignal) {
    const url = this.endpoint(path);
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": userAgent,
          ...(this.credential
            ? { Authorization: `Bearer ${this.credential}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : undefined;
      throw new NetworkError(this.url, code, error);
    }
  }

  async post<T>(path: string, body: unknown, signal?: AbortSignal) {
    const response = await this.raw(path, body, signal);
    if (response.status === 204) return null;
    return (await response.json()) as T;
  }

  register(request: MachineReport & { token: string; name: string }) {
    return this.post<{
      runnerId: string;
      organizationId: string;
      name: string;
      personal: boolean;
      credential: string;
    }>("/register", request);
  }

  heartbeat(
    report: MachineReport & {
      sessions: { sessionId: string; leaseToken: string }[];
      // The last problem the runner met; omitted, the server keeps the one
      // it has.
      lastError?: { message: string; at: string } | null;
    },
    signal?: AbortSignal,
  ) {
    return this.post<{
      serverTime: string;
      leases: {
        sessionId: string;
        held: boolean;
        status: string | null;
      }[];
    }>("/heartbeat", report, signal);
  }

  claim(wait: number, signal?: AbortSignal) {
    return this.post<Assignment>("/claim", { wait }, signal);
  }

  session(id: string) {
    const path = (action: string) =>
      `/sessions/${encodeURIComponent(id)}/${action}`;
    return {
      start: (leaseToken: string) =>
        this.post<{ status: string }>(path("start"), { leaseToken }),
      events: (leaseToken: string, events: unknown[]) =>
        this.post<{ acked: number; status: string }>(path("events"), {
          leaseToken,
          events,
        }),
      inputs: (
        leaseToken: string,
        after: number,
        wait: number,
        signal?: AbortSignal,
      ) =>
        this.post<{ status: string; inputs: SessionInput[] }>(
          path("inputs"),
          { leaseToken, after, wait },
          signal,
        ),
      workspace: (leaseToken: string) =>
        this.post<WorkspaceResponse>(path("workspace"), { leaseToken }),
      complete: (body: {
        leaseToken: string;
        outcome: "completed" | "failed";
        summary?: string;
        error?: string;
        branch?: string;
        lastSeq: number;
      }) => this.post<{ status: string }>(path("complete"), body),
      release: (leaseToken: string) =>
        this.post<{ status: string }>(path("release"), { leaseToken }),
      model: (leaseToken: string, call: unknown, signal?: AbortSignal) =>
        this.raw(path("model"), { leaseToken, call }, signal),
    };
  }
}

export const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

// Retries transient failures (network errors, 429, 5xx) with backoff;
// protocol refusals are returned to the caller at once.
export async function withRetry<T>(
  call: () => Promise<T>,
  options: {
    signal?: AbortSignal;
    attempts?: number;
    onRetry?: (e: unknown) => void;
  } = {},
) {
  const attempts = options.attempts ?? 8;
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const transient = !(error instanceof ProtocolError) || error.retryable;
      if (!transient || attempt >= attempts || options.signal?.aborted)
        throw error;
      options.onRetry?.(error);
      await delay(Math.min(30_000, 500 * 2 ** attempt), options.signal);
    }
  }
}
