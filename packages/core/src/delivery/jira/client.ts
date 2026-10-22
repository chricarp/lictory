import { DeliveryError } from "@lictory/core/delivery/provider";

// Minimal Jira Cloud REST v3 client: basic auth with an API token, bounded
// retries honouring Retry-After, and Jira error bodies mapped to actionable
// DeliveryErrors. Credentials never appear in error messages.

export type JiraCredential = { email: string; apiToken: string };

export type JiraClientOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  // Per request; a hung connection must not hold a publication forever.
  timeoutMs?: number;
};

export type JiraRequestOptions = {
  // Not idempotent (creating an issue): a timeout, network error or 5xx may
  // have been applied, so it is not retried here. The caller recovers the
  // attempt instead (see the delivery service's create confirmation).
  once?: boolean;
};

export function jiraCredential(value: unknown): JiraCredential {
  const credential = value as Partial<JiraCredential> | null;
  if (
    !credential ||
    typeof credential.email !== "string" ||
    typeof credential.apiToken !== "string"
  )
    throw new DeliveryError(
      "authentication",
      "The Jira connection has no usable API token. Reconnect Jira.",
    );
  return { email: credential.email, apiToken: credential.apiToken };
}

export function createJiraClient(options: JiraClientOptions = {}) {
  const doFetch = options.fetch ?? fetch;
  const sleep =
    options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = options.maxAttempts ?? 4;
  const maxDelay = options.maxRetryDelayMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 30_000;

  return async function request<T>(
    baseUrl: string,
    credential: JiraCredential,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    call: JiraRequestOptions = {},
  ): Promise<T | null> {
    const authorization = `Basic ${Buffer.from(
      `${credential.email}:${credential.apiToken}`,
    ).toString("base64")}`;
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}${path}`, {
          method,
          headers: {
            Authorization: authorization,
            Accept: "application/json",
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        if (attempt < maxAttempts && !call.once) {
          await sleep(backoff(attempt, maxDelay));
          continue;
        }
        throw new DeliveryError(
          "unavailable",
          `Jira at ${baseUrl} could not be reached. Try again later.`,
        );
      }
      if (response.ok) {
        const text = await response.text();
        return text ? (JSON.parse(text) as T) : null;
      }
      // 429 means the request was not processed; a 5xx may have been.
      const retryable =
        response.status === 429 || (response.status >= 500 && !call.once);
      if (retryable && attempt < maxAttempts) {
        const header = Number(response.headers.get("Retry-After"));
        const delay =
          Number.isFinite(header) && header > 0
            ? Math.min(header * 1000, maxDelay)
            : backoff(attempt, maxDelay);
        await sleep(delay);
        continue;
      }
      throw await toError(response, credential.email);
    }
  };
}

export type JiraRequest = ReturnType<typeof createJiraClient>;

function backoff(attempt: number, max: number) {
  return Math.min(500 * 2 ** (attempt - 1), max);
}

async function toError(response: Response, email: string) {
  let detail: { errorMessages?: string[]; errors?: Record<string, string> } =
    {};
  try {
    detail = (await response.json()) as typeof detail;
  } catch {
    // Non-JSON error body (proxy, outage page): fall back to the status.
  }
  const fieldErrors = detail.errors ?? {};
  const messages = [
    ...(detail.errorMessages ?? []),
    ...Object.entries(fieldErrors).map(
      ([field, message]) => `${field}: ${message}`,
    ),
  ];
  const reason = messages.join(" ");
  switch (response.status) {
    case 401:
      return new DeliveryError(
        "authentication",
        `Jira rejected the API token for ${email}. Reconnect Jira with a valid token.`,
      );
    case 403:
      return new DeliveryError(
        "permission",
        `The Jira account ${email} lacks permission for this action.${reason ? ` ${reason}` : ""}`,
      );
    case 404:
      return new DeliveryError(
        "not_found",
        reason ||
          "The Jira item or project no longer exists or is not visible.",
      );
    case 429: {
      const retryAfter = Number(response.headers.get("Retry-After"));
      return new DeliveryError(
        "rate_limited",
        "Jira is rate limiting requests. Retry in a moment.",
        {},
        Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
      );
    }
    default:
      if (response.status >= 500)
        return new DeliveryError(
          "unavailable",
          `Jira returned an error (${response.status}). Try again later.`,
        );
      return new DeliveryError(
        "validation",
        reason
          ? `Jira rejected the request: ${reason}`
          : "Jira rejected the request.",
        fieldErrors,
      );
  }
}
