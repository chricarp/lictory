import { z } from "zod";
import { LogoError } from "@lictory/core/branding/server";
import { DeliveryError } from "@lictory/core/delivery/provider";
import { SlackError } from "@lictory/core/channels/slack/api";
import { ConversionError } from "@lictory/core/intelligence/convert";
import { ContextError } from "@lictory/core/intelligence/server";
import {
  ATTACHMENTS_UNAVAILABLE,
  StorageConfigurationError,
} from "@lictory/core/storage/errors";
import { DomainError } from "@lictory/core/domain/errors";
import {
  CapabilityError,
  type ErrorCategory,
} from "@lictory/core/capabilities/core";

function fromStatus(status: number): ErrorCategory {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "not_found";
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
      ...(error.kind ? { kind: error.kind } : {}),
    });
  if (error instanceof DeliveryError)
    return new CapabilityError("external", error.message, {
      kind: error.kind,
      retryable: error.retryable,
    });
  if (error instanceof SlackError)
    return new CapabilityError("external", error.message, {
      kind: `slack_${error.kind}`,
      retryable: error.kind === "rate_limited" || error.kind === "transient",
    });
  if (error instanceof ContextError || error instanceof LogoError)
    return new CapabilityError(fromStatus(error.status), error.message, {
      status: error.status,
    });
  if (error instanceof ConversionError)
    return new CapabilityError("validation", error.message);
  if (error instanceof StorageConfigurationError)
    return new CapabilityError("unavailable", ATTACHMENTS_UNAVAILABLE, {
      status: 503,
    });
  if (error instanceof z.ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: readable(issue),
    }));
    return new CapabilityError(
      "validation",
      issues.length === 1
        ? issues[0]!.message
        : `The input is invalid: ${issues.map((i) => i.message).join(" ")}`,
      { issues },
    );
  }
  return new CapabilityError(
    "server",
    "The operation failed unexpectedly. Retry shortly.",
  );
}

// Validation messages name the field they are about, in words people and
// models act on, instead of the schema library's defaults ("Too small:
// expected string to have >=1 characters").
function readable(issue: z.core.$ZodIssue) {
  const path = issue.path.join(".");
  const field = path || "The input";
  if (
    issue.code === "invalid_type" &&
    issue.message.endsWith("received undefined")
  )
    return `${field} is required.`;
  if (
    issue.code === "too_small" &&
    issue.origin === "string" &&
    Number(issue.minimum) === 1
  )
    return `${field} cannot be empty.`;
  if (issue.code === "too_small" || issue.code === "too_big") {
    const bound = issue.code === "too_small" ? "at least" : "at most";
    const limit = Number(
      issue.code === "too_small" ? issue.minimum : issue.maximum,
    );
    if (issue.origin === "string")
      return `${field} is ${bound} ${limit} characters long.`;
    if (issue.origin === "array")
      return `${field} holds ${bound} ${limit} ${limit === 1 ? "entry" : "entries"}.`;
    if (issue.origin === "number" || issue.origin === "int")
      return `${field} is ${bound} ${limit}.`;
  }
  return path && !issue.message.startsWith(path)
    ? `${path}: ${issue.message}`
    : issue.message;
}
