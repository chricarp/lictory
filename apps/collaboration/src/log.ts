import { DomainError } from "@lictory/core/domain/errors";

// Structured logs of the collaboration service. Document names, content and
// raw database messages (which can carry SQL values) are never logged: only
// identifiers, counts, categories and messages written for users.

export type Log = (
  level: "info" | "warn" | "error",
  event: string,
  fields?: Record<string, unknown>,
) => void;

export const jsonLog: Log = (level, event, fields = {}) => {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    service: "collaboration",
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};

export function describeError(error: unknown) {
  if (!(error instanceof Error))
    return { errorCategory: "internal", errorName: typeof error };
  const e = error as Error & { code?: unknown; severity?: unknown };
  const code = typeof e.code === "string" ? e.code : undefined;
  if (error instanceof DomainError)
    return {
      errorCategory: `domain.${error.category}`,
      errorName: "DomainError",
      message: error.message,
    };
  if (code && typeof e.severity === "string")
    return { errorCategory: "database", errorName: e.name, errorCode: code };
  if (
    code &&
    /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|CONNECTION_\w+|CONNECT_TIMEOUT)$/.test(
      code,
    )
  )
    return { errorCategory: "connection", errorName: e.name, errorCode: code };
  return { errorCategory: "internal", errorName: e.name, errorCode: code };
}
