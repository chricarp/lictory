import { z } from "zod";
import { LogoError } from "../branding/server";
import { DeliveryError } from "../delivery/provider";
import { ConversionError } from "../intelligence/convert";
import { ContextError } from "../intelligence/server";
import { StorageConfigurationError } from "../storage/errors";
import { DomainError } from "../sync/server/errors";
import { CapabilityError, type ErrorCategory } from "./core";

function fromStatus(status: number): ErrorCategory {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "unavailable";
  if (status === 409) return "conflict";
  if (status >= 500) return "server";
  return "validation";
}

// Maps every domain and boundary error to the shared shape. Unknown errors
// become a generic server error: raw exceptions can contain SQL values,
// credentials or document contents and are never shown to callers.
export function toCapabilityError(error: unknown): CapabilityError {
  if (error instanceof CapabilityError) return error;
  if (error instanceof DomainError)
    return new CapabilityError(error.category, error.message, {
      ...(error.currentRevisionId
        ? { currentRevisionId: error.currentRevisionId }
        : {}),
    });
  if (error instanceof DeliveryError)
    return new CapabilityError("external", error.message, {
      kind: error.kind,
      retryable: error.retryable,
    });
  if (error instanceof ContextError || error instanceof LogoError)
    return new CapabilityError(fromStatus(error.status), error.message, {
      status: error.status,
    });
  if (error instanceof ConversionError)
    return new CapabilityError("validation", error.message);
  if (error instanceof StorageConfigurationError)
    return new CapabilityError(
      "unavailable",
      "File storage is not configured. Ask an administrator to add storage credentials.",
      { status: 503 },
    );
  if (error instanceof z.ZodError)
    return new CapabilityError("validation", "The input is invalid.", {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  return new CapabilityError(
    "server",
    "The operation failed unexpectedly. Retry shortly.",
  );
}
