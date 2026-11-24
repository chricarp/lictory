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
    const response = await fetch(this.endpoint(path), {
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
    if (!response.ok) {
      const json = (await response.json().catch(() => null)) as {
        error?: { message?: string; kind?: string; acked?: number };
      } | null;
      throw new ProtocolError(
        response.status,
        json?.error?.message ?? `The server answered ${response.status}.`,
        json?.error?.kind,
        json?.error?.acked,
      );
    }
    return response;
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
    },
  ) {
    return this.post<{
      serverTime: string;
      leases: {
        sessionId: string;
        held: boolean;
        status: string | null;
      }[];
    }>("/heartbeat", report);
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
