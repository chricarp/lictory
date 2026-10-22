import { AnalyzerError } from "@lictory/core/ai/analyzer";
import { DeliveryError } from "@lictory/core/delivery/provider";
import { DomainError } from "@lictory/core/domain/errors";

// Error categories and safe fields for worker logs. Raw messages can carry
// SQL values, provider bodies or specification text, so only messages that
// were written for users (delivery, AI and domain errors) are logged as is.

type Categorized = {
  errorCategory: string;
  errorName: string;
  errorCode?: string;
  message?: string;
};

export function describeError(error: unknown): Categorized {
  if (!(error instanceof Error))
    return { errorCategory: "internal", errorName: typeof error };
  const e = error as Error & { code?: unknown; severity?: unknown };
  const code = typeof e.code === "string" ? e.code : undefined;
  if (error instanceof DeliveryError)
    return {
      errorCategory: `delivery.${error.kind}`,
      errorName: "DeliveryError",
      message: error.message,
    };
  if (error instanceof AnalyzerError)
    return {
      errorCategory: "ai",
      errorName: "AnalyzerError",
      message: error.message,
    };
  if (error instanceof DomainError)
    return {
      errorCategory: `domain.${error.category}`,
      errorName: "DomainError",
      message: error.message,
    };
  // postgres.js server errors carry a SQLSTATE and a severity.
  if (code && typeof e.severity === "string")
    return { errorCategory: "database", errorName: e.name, errorCode: code };
  if (
    code &&
    /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|CONNECTION_\w+|CONNECT_TIMEOUT)$/.test(
      code,
    )
  )
    return { errorCategory: "connection", errorName: e.name, errorCode: code };
  if (e.name === "AbortError" || e.name === "TimeoutError")
    return { errorCategory: "timeout", errorName: e.name };
  return { errorCategory: "internal", errorName: e.name, errorCode: code };
}

export type Log = (
  level: "info" | "warn" | "error",
  event: string,
  fields?: Record<string, unknown>,
) => void;

export const jsonLog: Log = (level, event, fields = {}) => {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    service: "worker",
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};
