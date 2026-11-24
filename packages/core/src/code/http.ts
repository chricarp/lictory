import { codeHostFetch } from "@lictory/core/code/egress";
import { CodeHostError } from "@lictory/core/code/provider";

// The HTTP client the code host adapters share: bounded retries honouring
// Retry-After, a timeout per request, no redirects, and host errors mapped
// to actionable CodeHostErrors. Credentials never appear in messages.

export type CodeHttpOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  timeoutMs?: number;
};

export type CodeRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  // Form-encoded body instead of JSON.
  form?: Record<string, string>;
  // Not idempotent: a timeout or 5xx may have been applied, so it is not
  // retried here; the outbox recovers it instead.
  once?: boolean;
  // Return the body as text (diffs).
  text?: boolean;
};

export type CodeResponse<T> = { data: T; headers: Headers; status: number };

// How one host words its errors.
export type ErrorReader = (
  status: number,
  body: unknown,
  headers: Headers,
) => { message?: string; rateLimited?: boolean } | undefined;

export function createCodeHttp(
  product: string,
  readError: ErrorReader,
  options: CodeHttpOptions = {},
) {
  const doFetch = options.fetch ?? codeHostFetch;
  const sleep =
    options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = options.maxAttempts ?? 3;
  const maxDelay = options.maxRetryDelayMs ?? 20_000;
  const timeoutMs = options.timeoutMs ?? 20_000;

  return async function request<T>(
    url: string,
    call: CodeRequest = {},
  ): Promise<CodeResponse<T>> {
    const method = call.method ?? "GET";
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "Lictory",
      ...call.headers,
    };
    let body: string | undefined;
    if (call.form) {
      body = new URLSearchParams(call.form).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (call.body !== undefined) {
      body = JSON.stringify(call.body);
      headers["Content-Type"] = "application/json";
    }
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "manual",
        });
      } catch (error) {
        if (error instanceof CodeHostError) throw error;
        if (attempt < maxAttempts && !call.once) {
          await sleep(backoff(attempt, maxDelay));
          continue;
        }
        throw new CodeHostError(
          "unavailable",
          `${product} could not be reached. Try again later.`,
        );
      }
      if (
        response.type === "opaqueredirect" ||
        (response.status >= 300 && response.status < 400)
      )
        throw new CodeHostError(
          "validation",
          `${product} redirected the request instead of answering it. If the host moved, reconnect it with its new address.`,
        );
      if (response.ok) {
        const text = await response.text();
        let data: unknown = null;
        if (call.text) data = text;
        else if (text)
          try {
            data = JSON.parse(text);
          } catch {
            throw new CodeHostError(
              "unavailable",
              `${product} answered with something other than JSON. Check the connection's address.`,
            );
          }
        return { data: data as T, headers: response.headers, status: 200 };
      }
      let detail: unknown = null;
      const raw = await response.text().catch(() => "");
      try {
        detail = raw ? JSON.parse(raw) : null;
      } catch {
        detail = raw;
      }
      const read = readError(response.status, detail, response.headers) ?? {};
      const rateLimited = response.status === 429 || read.rateLimited === true;
      const retryable = rateLimited || (response.status >= 500 && !call.once);
      const retryAfter = retryAfterMs(response.headers);
      if (retryable && attempt < maxAttempts) {
        await sleep(
          retryAfter !== undefined
            ? Math.min(retryAfter, maxDelay)
            : backoff(attempt, maxDelay),
        );
        continue;
      }
      throw toError(
        product,
        response.status,
        read.message,
        rateLimited,
        retryAfter,
      );
    }
  };
}

export type CodeHttp = ReturnType<typeof createCodeHttp>;

function backoff(attempt: number, max: number) {
  return Math.min(500 * 2 ** (attempt - 1), max);
}

function retryAfterMs(headers: Headers) {
  const after = Number(headers.get("retry-after"));
  if (Number.isFinite(after) && after > 0) return after * 1000;
  // GitHub: seconds since the epoch when the window resets.
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0)
    return Math.max(0, reset * 1000 - Date.now());
  return undefined;
}

function toError(
  product: string,
  status: number,
  reason: string | undefined,
  rateLimited: boolean,
  retryAfter: number | undefined,
) {
  const detail = reason ? ` ${reason}` : "";
  if (rateLimited)
    return new CodeHostError(
      "rate_limited",
      `${product} is rate limiting requests. Lictory retries automatically.`,
      retryAfter,
    );
  switch (status) {
    case 401:
      return new CodeHostError(
        "authentication",
        `${product} rejected the connection's credential. An organization administrator must reconnect it.`,
      );
    case 403:
      return new CodeHostError(
        "permission",
        `The connection's account lacks permission for this on ${product}.${detail}`,
      );
    case 404:
      return new CodeHostError(
        "not_found",
        (reason ?? "") ||
          `${product} has no such repository, branch or pull request, or the connection cannot see it.`,
      );
    case 405:
    case 409:
      return new CodeHostError(
        "conflict",
        (reason ?? "") || `${product} refused the change in its current state.`,
      );
    default:
      if (status >= 500)
        return new CodeHostError(
          "unavailable",
          `${product} returned an error (${status}). Try again later.`,
        );
      return new CodeHostError(
        "validation",
        reason
          ? `${product} refused the request:${detail}`
          : `${product} refused the request.`,
      );
  }
}

// Collects pages until `limit` items or no next page.
export async function collect<T>(
  first: string,
  fetchPage: (url: string) => Promise<{ items: T[]; next: string | null }>,
  limit = 500,
) {
  const items: T[] = [];
  let url: string | null = first;
  while (url && items.length < limit) {
    const page = await fetchPage(url);
    items.push(...page.items);
    url = page.next;
  }
  return items.slice(0, limit);
}

// The `next` URL of an RFC 8288 Link header (GitHub, GitLab). Only a link
// to the API's own origin is followed: the credential goes with it.
export function nextLink(headers: Headers, api: string): string | null {
  const link = headers.get("link");
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (match) return sameOrigin(match[1]!, api);
  }
  return null;
}

export function sameOrigin(url: string, api: string): string | null {
  try {
    return new URL(url).origin === new URL(api).origin ? url : null;
  } catch {
    return null;
  }
}

export function excerpt(text: string | null | undefined, max = 2000) {
  const value = (text ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function date(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
