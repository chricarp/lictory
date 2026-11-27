// Structured log lines of the API, in the shape the worker and the
// collaboration service write: one JSON object per line with the time, the
// level, the service and the event, so a log pipeline filters and orders
// every service's lines alike. Secrets and request bodies are never logged.

export type Log = (
  level: "info" | "warn" | "error",
  event: string,
  fields?: Record<string, unknown>,
) => void;

export const jsonLog: Log = (level, event, fields = {}) => {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    service: "api",
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};
