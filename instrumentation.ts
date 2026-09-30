import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

function createLogProvider() {
  if (!projectToken || !host) return null;
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
