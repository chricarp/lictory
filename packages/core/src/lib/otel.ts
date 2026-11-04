import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { posthogServerConfig } from "@lictory/core/lib/analytics/config";
import type { Environment } from "@lictory/core/lib/env";

// Server log export to PostHog, on when POSTHOG_PROJECT_TOKEN and
// POSTHOG_HOST are set.
export function createLogProvider(source: Environment = process.env) {
  const config = posthogServerConfig(source);
  if (!config) return null;
  const { token: projectToken, host } = config;
  try {
    return new LoggerProvider({
      resource: resourceFromAttributes({ "service.name": "lictory" }),
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: new URL("/i/v1/logs", host).toString(),
            headers: {
              Authorization: `Bearer ${projectToken}`,
              "Content-Type": "application/json",
            },
          }),
        }),
      ],
    });
  } catch {
    return null;
  }
}
export const posthogLogProvider = createLogProvider();

export function register() {
  // This provider is intentionally not global: only the dedicated logger in
  // src/lib/posthog-logs.ts is exported to PostHog.
}
