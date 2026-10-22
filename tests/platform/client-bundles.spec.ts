import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// What browsers download must never contain server configuration or
// server-only code: the built SPA (served as static files) and the
// website's client chunks are scanned as shipped.

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

// Values the stack under test runs with (scripts/test-e2e.ts), and markers of
// modules that only the API, the worker or the database layer may load.
const secrets = [
  "e2e-local-only-secret-with-at-least-thirty-two-characters",
  "e2e-google-client-secret",
  "e2e-microsoft-client-secret",
  "e2e-zero-api-key",
  "e2e-zero-admin",
  "lictory:lictory@",
  "postgresql://",
];
const serverOnly = [
  /from ["']drizzle-orm/,
  /\bpgTable\(/,
  /\bS3Client\b/,
  /nodemailer/,
  /\bapplyMutation\b/,
  /\bhashPassword\b/,
  /\bpg_notify\b/,
  /R2_SECRET_ACCESS_KEY/,
  /ZERO_(QUERY|MUTATE)_API_KEY/,
  /DATABASE_URL/,
];

for (const [name, directory] of [
  ["platform SPA", "apps/platform/dist"],
  ["website client chunks", "apps/marketing/.next/static"],
] as const)
  test(`${name}: no secrets or server-only code`, () => {
    const shipped = files(directory).filter((f) =>
      /\.(js|mjs|css|html|json)$/.test(f),
    );
    expect(shipped.length).toBeGreaterThan(0);
    const findings: string[] = [];
    for (const file of shipped) {
      const content = readFileSync(file, "utf8");
      for (const secret of secrets)
        if (content.includes(secret)) findings.push(`${file}: ${secret}`);
      for (const marker of serverOnly)
        if (marker.test(content)) findings.push(`${file}: ${marker}`);
    }
    expect(findings).toEqual([]);
  });
