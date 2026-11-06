// Startup validation for the API, the worker, the collaboration service and
// the migration runner. Every problem is collected before the process stops,
// so an operator fixes the configuration in one pass. Secrets are never
// echoed.
import {
  declarations,
  type Declaration,
  type ValidatedService,
} from "@lictory/core/config/declarations";
import { derivedCredentialsKeyInProduction } from "@lictory/core/delivery/credentials";
import { env, type Environment } from "@lictory/core/lib/env";

export type ConfigurationReport = { problems: string[]; warnings: string[] };

/**
 * A rule that spans several variables and lives with the code it protects
 * (such as the mail transport). Returns the problem (the service does not
 * start), a warning (it starts and logs it), or undefined.
 */
export type ConfigurationRule = (
  source: Environment,
) => string | { warning: string } | undefined;

const minimumSecretBytes = 32;

// Values shipped in this repository's examples and runbooks. They are public,
// so a production secret must never equal one of them.
const knownPlaceholders = new Set([
  "local-development-secret-change-before-production",
  "ci-only-secret-not-a-production-credential-32",
  "generate",
]);
const placeholderPattern =
  /change[-_ ]?(?:me|before[-_ ]?production)|replace[-_ ]?(?:me|with)|placeholder/i;

const validated: readonly ValidatedService[] = [
  "api",
  "worker",
  "collaboration",
  "migrate",
];

function required(
  declaration: Declaration,
  service: ValidatedService,
  production: boolean,
) {
  if (!declaration.required) return false;
  if (declaration.required === "production" && !production) return false;
  const by =
    declaration.requiredBy ??
    validated.filter((s) => declaration.services.includes(s));
  return by.includes(service);
}

function valueProblem({ name, value: kind }: Declaration, value: string) {
  switch (kind?.type) {
    case "integer": {
      const minimum = kind.minimum ?? 0;
      return /^\d+$/.test(value) && Number(value) >= minimum
        ? undefined
        : `${name} must be a whole number${minimum > 0 ? ` of at least ${minimum}` : ""}, got "${value}".`;
    }
    case "boolean":
      return /^(?:true|yes|1|false|no|0)$/i.test(value)
        ? undefined
        : `${name} must be true or false, got "${value}".`;
    case "choice":
      return kind.values.includes(value)
        ? undefined
        : `${name} must be one of ${kind.values.join(", ")}, got "${value}".`;
    case "origin": {
      let url: URL | undefined;
      try {
        url = new URL(value);
      } catch {
        // Reported below.
      }
      return url &&
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
        ? undefined
        : `${name} must be an http(s) origin without a path, such as https://app.example.com, got "${value}".`;
    }
    default:
      return undefined;
  }
}

function secretProblem({ name, secret }: Declaration, value: string) {
  if (
    knownPlaceholders.has(value.toLowerCase()) ||
    placeholderPattern.test(value)
  )
    return `${name} is a placeholder value from an example file. Set a real secret${secret === "generated" ? " (openssl rand -hex 32)" : ""}.`;
  if (
    secret === "generated" &&
    Buffer.byteLength(value, "utf8") < minimumSecretBytes
  )
    return `${name} is shorter than ${minimumSecretBytes} bytes. Generate one with openssl rand -hex 32.`;
  return undefined;
}

/** Checks the configuration one service reads. Pure: no logging, no exit. */
export function checkConfiguration(
  service: ValidatedService,
  source: Environment = process.env,
  rules: readonly ConfigurationRule[] = [],
): ConfigurationReport {
  const production = env("NODE_ENV", source) === "production";
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const declaration of declarations) {
    if (!declaration.services.includes(service)) continue;
    const value = env(declaration.name, source);
    if (value === undefined) {
      if (required(declaration, service, production))
        problems.push(
          `${declaration.name} is required${declaration.required === "production" ? " in production" : ""}. ${declaration.description}`,
        );
      continue;
    }
    const problem =
      valueProblem(declaration, value) ??
      (production && declaration.secret
        ? secretProblem(declaration, value)
        : undefined);
    if (problem) problems.push(problem);
  }
  for (const rule of rules) {
    const result = rule(source);
    if (typeof result === "string") problems.push(result);
    else if (result) warnings.push(result.warning);
  }
  // Existing installations may have stored Jira credentials with the key
  // derived from BETTER_AUTH_SECRET; they keep working. New installations
  // cannot store any until the key is set (delivery/credentials.ts).
  if (
    (service === "api" || service === "worker") &&
    derivedCredentialsKeyInProduction(source)
  )
    warnings.push(
      "DELIVERY_CREDENTIALS_KEY is not set. Stored Jira credentials stay encrypted with a key derived from BETTER_AUTH_SECRET, so rotating BETTER_AUTH_SECRET would make them unreadable, and an installation without stored credentials cannot connect Jira. Set DELIVERY_CREDENTIALS_KEY to the current BETTER_AUTH_SECRET value (keeps existing credentials readable) or, on a new installation, to a new secret. See docs/operations/configuration.md.",
    );
  return { problems, warnings };
}

/**
 * Validates the configuration of the starting service: logs warnings and, when
 * anything is wrong, lists every problem and stops the process. Import the
 * service's configuration module first so this runs before other modules read
 * the environment.
 */
export function loadConfiguration(
  service: ValidatedService,
  rules: readonly ConfigurationRule[] = [],
  source: Environment = process.env,
) {
  const { problems, warnings } = checkConfiguration(service, source, rules);
  for (const message of warnings)
    console.warn(JSON.stringify({ event: "config.warning", service, message }));
  if (problems.length === 0) return;
  console.error(
    [
      `Lictory ${service} cannot start: ${problems.length === 1 ? "1 configuration problem" : `${problems.length} configuration problems`}.`,
      ...problems.map((problem) => `  - ${problem}`),
      "See docs/operations/configuration.md.",
    ].join("\n"),
  );
  process.exit(1);
}
