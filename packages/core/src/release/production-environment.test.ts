import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  textProviders,
  transcriptionProviders,
} from "@lictory/core/contracts/ai-provider";

// The API and the worker start with the environment deploy/compose.production.yaml
// actually gives them when the operator sets only the required settings:
// every optional setting arrives as an empty string (`${NAME:-}`). v0.24.0
// could not start this way: @ai-sdk/openai, loaded with the API, refused the
// blank OPENAI_BASE_URL. The services run as the image runs them: the esbuild
// bundle on Node.

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
    // Forms without the colon (`${NAME-default}`) treat an empty value
    // differently; the file does not use them, so they are refused here.
    const [, name, operation, argument = ""] =
      /^(\w+)(?::([-?+])([\s\S]*))?$/.exec(expression) ?? [];
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

// Runs a command with exactly `env` (plus PATH) until it has logged every
// event in `until` (then stops it), it exits, or the deadline passes. The
// child is always gone when this returns.
async function run(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    until?: string[];
    timeoutMs?: number;
  },
) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { PATH: process.env.PATH ?? "", ...options.env },
  });
  let output = "";
  const seen = () =>
    options.until?.every((event) => output.includes(`"event":"${event}"`)) ??
    false;
  const closed = new Promise<number | null>((resolve) => {
    child.on("close", resolve);
    child.on("error", (error) => {
      output += `\n${error.message}`;
      resolve(null);
    });
  });
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
    if (seen()) child.kill("SIGTERM");
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const timer = setTimeout(() => {
    output += "\n(timed out)";
    child.kill("SIGKILL");
  }, options.timeoutMs ?? 60_000);
  try {
    const code = await closed;
    return { started: seen(), code, output };
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
  }
}

// Builds a service with its own build script into a directory inside
// node_modules/.cache, where Node resolves the external npm packages as it
// does in the image (/app/node_modules), then runs it on Node.
async function startBundle(
  service: "api" | "worker",
  env: Record<string, string>,
  until: string[],
) {
  const cache = join(repository, "node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  const bundle = mkdtempSync(join(cache, `lictory-${service}-bundle-`));
  // An empty directory: no .env file or anything else configures it.
  const cwd = mkdtempSync(join(tmpdir(), "lictory-production-env-"));
  try {
    execFileSync("node", ["build.mjs", bundle], {
      cwd: join(repository, "apps", service),
      stdio: "pipe",
    });
    return await run("node", [join(bundle, "index.js")], { cwd, env, until });
  } finally {
    rmSync(bundle, { recursive: true, force: true });
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
  "the API bundle starts on Node with the environment compose gives it",
  { timeout: 90_000 },
  async () => {
    const { started, output } = await startBundle(
      "api",
      {
        ...composeEnvironment("api"),
        DATABASE_URL: unreachableDatabase,
        PORT: "0",
      },
      ["api.listening"],
    );
    assert.ok(started, output);
  },
);

void test(
  "the worker bundle starts on Node with the environment compose gives it",
  { timeout: 90_000 },
  async () => {
    const { started, output } = await startBundle(
      "worker",
      {
        ...composeEnvironment("worker"),
        DATABASE_URL: unreachableDatabase,
        WORKER_HEALTH_PORT: "0",
      },
      ["worker.started", "worker.health"],
    );
    assert.ok(started, output);
  },
);

// Every variable the provider SDKs and the AWS and Google credential chains
// read themselves, blank or whitespace-only, as an environment forwarding
// unset settings would leave them.
const blankSdkVariables = Object.fromEntries(
  [
    "OPENAI_BASE_URL",
    "OPENAI_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_VERTEX_API_KEY",
    "GOOGLE_VERTEX_PROJECT",
    "GOOGLE_VERTEX_LOCATION",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GCLOUD_PROJECT",
    "GCE_METADATA_HOST",
    "AZURE_API_KEY",
    "AZURE_RESOURCE_NAME",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "AWS_ENDPOINT_URL",
    "AWS_ENDPOINT_URL_BEDROCK_RUNTIME",
    "MISTRAL_API_KEY",
    "XAI_API_KEY",
    "GROQ_API_KEY",
    "DEEPSEEK_API_KEY",
    "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY",
    "ASSEMBLYAI_API_KEY",
  ].map((name, i) => [name, i % 2 ? " " : ""]),
);

// Each adapter in its own process, so one provider's SDK loading cannot
// clean the environment for another's. With a key and without (Bedrock and
// Vertex then use the server's own AWS or Google identity, Azure Entra ID).
const adapters = [
  ...new Set(Object.values(textProviders).map((p) => p.adapter)),
].map((adapter) => ({ kind: "text", adapter }));
const transcriptionAdapters = [
  ...new Set(Object.values(transcriptionProviders).map((p) => p.adapter)),
]
  .filter((adapter) => adapter !== "openai-realtime")
  .map((adapter) => ({ kind: "transcription", adapter }));

void test(
  "every AI provider's SDK loads with its own variables blank",
  { timeout: 120_000 },
  async () => {
    const provider = join(repository, "packages/core/src/ai/provider.ts");
    const cases = [...adapters, ...transcriptionAdapters];
    const failures: string[] = [];
    // A few at a time: each is a short process.
    for (let i = 0; i < cases.length; i += 4)
      await Promise.all(
        cases.slice(i, i + 4).map(async ({ kind, adapter }) => {
          const base = {
            provider: adapter,
            adapter,
            mode: "segments",
            model: "m",
            baseURL: "https://models.example.com/v1",
            customBaseUrl: true,
            urlSetting: "LICTORY_AI_BASE_URL",
            region: "us-east-1",
            project: "p",
            location: "us-central1",
            structuredOutput: "json-schema",
            timeoutMs: 1000,
            source: "environment",
          };
          const build =
            kind === "text" ? "languageModel" : "transcriptionModel";
          // Vertex transcription takes Google Cloud credentials, never a key.
          const keyed = !(kind === "transcription" && adapter === "vertex");
          const script = `const p = await import(${JSON.stringify(provider)});
const base = ${JSON.stringify(base)};
${keyed ? `await p.${build}({ ...base, apiKey: "test-key" });` : ""}
await p.${build}(base);
console.log(JSON.stringify({ event: "sdk.loaded" }));`;
          const { started, output } = await run(
            process.execPath,
            ["--no-env-file", "-e", script],
            {
              cwd: repository,
              env: blankSdkVariables,
              until: ["sdk.loaded"],
              timeoutMs: 30_000,
            },
          );
          if (!started) failures.push(`${kind} ${adapter}:\n${output}`);
        }),
      );
    assert.deepEqual(failures, []);
  },
);
