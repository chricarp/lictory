import { SeverityNumber } from "@opentelemetry/api-logs";
import { posthogLogProvider } from "@lictory/core/lib/otel";

const logger = posthogLogProvider?.getLogger("lictory-posthog-logs");

export function logScheduledJobsStarted() {
  logger?.emit({
    body: "Scheduled job processing started",
    severityNumber: SeverityNumber.INFO,
    attributes: {
      event: "scheduled_jobs_processing",
      status: "started",
    },
  });
}

export function logScheduledJobsCompleted() {
  logger?.emit({
    body: "Scheduled job processing completed",
    severityNumber: SeverityNumber.INFO,
    attributes: {
      event: "scheduled_jobs_processing",
      status: "completed",
    },
  });
}

export async function flushPosthogLogs() {
  await posthogLogProvider?.forceFlush();
}
