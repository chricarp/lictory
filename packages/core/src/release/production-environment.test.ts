import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The API and the worker start with the environment deploy/compose.production.yaml
// actually gives them when the operator sets only the required settings:
// every optional setting arrives as an empty string (`${NAME:-}`). v0.24.0
// could not start this way: @ai-sdk/openai, loaded with the API, refused the
// blank OPENAI_BASE_URL. The source entry points stand in for the images.

const repository = new URL("../../../../", import.meta.url).pathname;

// Only what compose requires (`${NAME:?}`); everything else is unset.
const operator: Record<string, string> = {
  LICTORY_ENVIRONMENT: "production",
  LICTORY_VERSION: "0.0.0-test",
  LICTORY_APP_PASSWORD: "app-password",
  LICTORY_DB_NAME: "lictory",
  APP_HOST: "app.example.com",
  BETTER_AUTH_SECRET: "a1".repeat(32),
  DELIVERY_CREDENTIALS_KEY: "b2".repeat(32),
  ZERO_API_KEY: "c3".repeat(32),
};

// Compose's interpolation for the forms the file uses: ${NAME},
// ${NAME:-default}, ${NAME:?message} and ${NAME:+alternative}, nested.
function interpolate(value: string, variables: Record<string, string>): string {
  let result = "";
  for (let i = 0; i < value.length;) {
    if (value.startsWith("$$", i)) {
      result += "$";
      i += 2;
      continue;
    }
    if (!value.startsWith("${", i)) {
      result += value[i++];
      continue;
    }
    let end = i;
    for (let depth = 0; end < value.length; end++) {
      if (value.startsWith("${", end)) {
        depth++;
        end++;
      } else if (value[end] === "}" && --depth === 0) break;
    }
    const expression = value.slice(i + 2, end);
    const [, name, operation, argument = ""] =
      /^(\w+)(?::([-?+]))?([\s\S]*)$/.exec(expression) ?? [];
    assert.ok(name, `unsupported interpolation \${${expression}}`);
    const set = Boolean(variables[name]);
    if (operation === "?")
      assert.ok(
        set,
        `compose requires ${name}; add it to the operator settings`,
      );
    result +=
      operation === "-"
        ? set
          ? variables[name]
          : interpolate(argument, variables)
        : operation === "+"
          ? set
            ? interpolate(argument, variables)
            : ""
          : (variables[name] ?? "");
    i = end + 1;
  }
  return result;
}

function composeEnvironment(service: "api" | "worker") {
  // Bun's built-in parser (anchors and merge keys included), as in
  // guardrails.test.ts, rather than a YAML dependency of the application.
  const compose = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "-e",
        "console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))",
        join(repository, "deploy/compose.production.yaml"),
      ],
      { encoding: "utf8" },
    ),
  ) as {
    services: Record<string, { environment: Record<string, unknown> }>;
  };
  return Object.fromEntries(
    Object.entries(compose.services[service]!.environment).map(
      ([name, value]) => [name, interpolate(String(value), operator)],
    ),
  );
}

// Runs an entry point until it logs `ready` (then stops it) or exits.
async function start(
  entry: string,
  env: Record<string, string>,
  ready: string,
) {
  const cwd = mkdtempSync(join(tmpdir(), "lictory-production-env-"));
  // `--no-env-file` and an empty directory: nothing but this environment.
  const child = spawn(process.execPath, ["--no-env-file", entry], {
    cwd,
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  let output = "";
  try {
    return await new Promise<{ started: boolean; output: string }>(
      (resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve({ started: false, output: `${output}\n(timed out)` });
        }, 60_000);
        const seen = (chunk: Buffer) => {
          output += chunk.toString();
          if (!output.includes(`"event":"${ready}"`)) return;
          clearTimeout(timer);
          child.kill("SIGTERM");
          resolve({ started: true, output });
        };
        child.stdout.on("data", seen);
        child.stderr.on("data", seen);
        child.on("exit", () => {
          clearTimeout(timer);
          resolve({ started: output.includes(`"event":"${ready}"`), output });
        });
      },
    );
  } finally {
    child.kill("SIGKILL");
    rmSync(cwd, { recursive: true, force: true });
  }
}

// No database is needed to start: nothing listens on port 9, and both
// services keep retrying it. Ports are the system's choice (shared hosts).
const unreachableDatabase = "postgresql://lictory_app:pw@127.0.0.1:9/lictory";

void test("compose passes every optional setting as an empty string", () => {
  for (const service of ["api", "worker"] as const) {
    const env = composeEnvironment(service);
    for (const name of [
      "OPENAI_BASE_URL",
      "LICTORY_AI_BASE_URL",
      "LICTORY_TRANSCRIPTION_BASE_URL",
      "LEGAL_TERMS_URL",
      "OAUTH_PROXY_URL",
      "S3_ENDPOINT",
      "SITE_URL",
    ])
      assert.equal(env[name], "", `${service} ${name}`);
  }
});

void test(
  "the API starts with the environment compose gives it",
  { timeout: 90_000 },
  async () => {
    const { started, output } = await start(
      join(repository, "apps/api/src/index.ts"),
      {
        ...composeEnvironment("api"),
        DATABASE_URL: unreachableDatabase,
        PORT: "0",
      },
      "api.listening",
    );
    assert.ok(started, output);
  },
);

void test(
  "the worker starts with the environment compose gives it",
  { timeout: 90_000 },
  async () => {
    const { started, output } = await start(
      join(repository, "apps/worker/src/index.ts"),
      {
        ...composeEnvironment("worker"),
        DATABASE_URL: unreachableDatabase,
        WORKER_HEALTH_PORT: "0",
      },
      "worker.health",
    );
    assert.ok(started, output);
  },
);

// AI configured in the admin console, with compose's blank OPENAI_BASE_URL
// still in the environment: the SDK is loaded on first use and must not see it.
void test(
  "an AI provider loads its SDK although compose leaves OPENAI_BASE_URL blank",
  { timeout: 60_000 },
  async () => {
    const script = join(repository, "packages/core/src/ai/provider.ts");
    const { started, output } = await new Promise<{
      started: boolean;
      output: string;
    }>((resolve) => {
      const child = spawn(
        process.execPath,
        [
          "--no-env-file",
          "-e",
          `const { languageModel, transcriptionModel } = await import(${JSON.stringify(script)});
const base = { apiKey: "sk-test", model: "m", source: "console", timeoutMs: 1000 };
await languageModel({ ...base, adapter: "openai", baseURL: "https://api.openai.com/v1" });
await languageModel({ ...base, adapter: "anthropic", baseURL: "https://api.anthropic.com/v1" });
await transcriptionModel({ ...base, adapter: "openai", baseURL: "https://api.openai.com/v1" });
console.log(JSON.stringify({ event: "sdk.loaded" }));`,
        ],
        {
          cwd: repository,
          env: {
            PATH: process.env.PATH ?? "",
            OPENAI_BASE_URL: "",
            OPENAI_API_KEY: "",
            ANTHROPIC_BASE_URL: " ",
          },
        },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.on("exit", (code) =>
        resolve({
          started: code === 0 && output.includes("sdk.loaded"),
          output,
        }),
      );
    });
    assert.ok(started, output);
  },
);
