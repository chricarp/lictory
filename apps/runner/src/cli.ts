#!/usr/bin/env bun
import { access, constants, mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import { parseArgs } from "node:util";
import { RunnerClient } from "@lictory/runner/client";
import {
  RUNNER_VERSION,
  configPath,
  homeDirectory,
  readConfig,
  readState,
  workDirectory,
  writeConfig,
  configSchema,
  containerImageProblem,
  pinnedImage,
} from "@lictory/runner/config";
import { machineReport, startDaemon } from "@lictory/runner/daemon";
import { fakeHarnesses, loadScript } from "@lictory/runner/harness/fake";
import { detectHarnesses, harnesses } from "@lictory/runner/harness/index";
import { run } from "@lictory/runner/process";
import { installService } from "@lictory/runner/service";

const usage = `lictory-runner ${RUNNER_VERSION}: runs Lictory agent sessions on this machine.

Usage:
  lictory-runner register --url <server> --token <registration token> [--name <name>]
                          [--max-sessions <n>] [--isolation host|container] [--label <label>]…
                          [--container-image <image@sha256:digest>]
  lictory-runner start [--test-harness <script.json|default>]
  lictory-runner status
  lictory-runner doctor
  lictory-runner install-service [--system] [--enable]

The configuration and credential live in ${homeDirectory()} (LICTORY_RUNNER_HOME).
`;

const out = (line: string) => console.log(line);

async function register(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      url: { type: "string" },
      token: { type: "string" },
      name: { type: "string" },
      "max-sessions": { type: "string" },
      isolation: { type: "string" },
      "container-image": { type: "string" },
      label: { type: "string", multiple: true },
      force: { type: "boolean" },
    },
  });
  if (!values.url || !values.token)
    throw new Error(
      "Give the server's address and a registration token: register --url <server> --token <token>.",
    );
  const existing = await readConfig();
  if (existing && !values.force)
    throw new Error(
      `This machine is already registered as ${existing.name} with ${existing.url}. Pass --force to replace it.`,
    );
  const base = configSchema.parse({
    url: values.url.replace(/\/$/, ""),
    runnerId: "pending",
    organizationId: "pending",
    name: values.name ?? hostname(),
    personal: false,
    credential: "pending",
    maxSessions: values["max-sessions"]
      ? Number(values["max-sessions"])
      : undefined,
    isolation: values.isolation,
    containerImage: values["container-image"],
    labels: values.label ?? [],
  });
  const imageProblem = containerImageProblem(base);
  if (imageProblem) throw new Error(imageProblem);
  const detected = await detectHarnesses(harnesses, base);
  const client = new RunnerClient(base.url, null);
  const registered = await client.register({
    ...machineReport(base, detected),
    token: values.token,
    name: base.name,
  });
  if (!registered)
    throw new Error("The server did not answer the registration.");
  await writeConfig({
    ...base,
    runnerId: registered.runnerId,
    organizationId: registered.organizationId,
    name: registered.name,
    personal: registered.personal,
    credential: registered.credential,
  });
  out(
    `Registered ${registered.name} as ${registered.personal ? "a personal" : "an organization"} runner. Configuration: ${configPath()}`,
  );
  out(
    "Start it with `lictory-runner start`, or keep it running with `lictory-runner install-service --enable`.",
  );
}

async function required() {
  const config = await readConfig();
  if (!config)
    throw new Error(
      "This machine is not registered. Run `lictory-runner register --url <server> --token <token>` first.",
    );
  return config;
}

async function start(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { "test-harness": { type: "string" } },
  });
  const config = await required();
  const imageProblem = containerImageProblem(config);
  if (imageProblem) throw new Error(imageProblem);
  const testScript =
    values["test-harness"] ?? process.env.LICTORY_RUNNER_TEST_HARNESS;
  let available = harnesses;
  if (testScript) {
    out(
      "Using the scripted test harness for every agent: nothing real will run.",
    );
    available = fakeHarnesses(await loadScript(testScript));
  }
  await mkdir(workDirectory(config), { recursive: true });
  out(
    `${config.name}: connecting to ${config.url} (${config.isolation}, up to ${config.maxSessions} sessions).`,
  );
  const { revoked } = await startDaemon(config, { harnesses: available });
  if (revoked) process.exitCode = 2;
}

async function status() {
  const config = await readConfig();
  if (!config) return out("Not registered.");
  out(
    `${config.name} (${config.personal ? "personal" : "organization"} runner) at ${config.url}`,
  );
  const state = await readState();
  let alive = false;
  if (state)
    try {
      process.kill(state.pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
  if (!state || !alive) return out("Not running.");
  out(
    `Running (pid ${state.pid}) since ${state.startedAt}. Last heartbeat: ${state.lastHeartbeatAt ?? "none yet"}.`,
  );
  if (state.lastError) out(`Last error: ${state.lastError}`);
  if (!state.sessions.length) out("No sessions.");
  for (const s of state.sessions)
    out(`  ${s.state.padEnd(9)} ${s.harness.padEnd(12)} ${s.title}`);
}

async function doctor() {
  let problems = 0;
  const check = (ok: boolean, line: string, fix?: string) => {
    out(`${ok ? "✓" : "✗"} ${line}`);
    if (!ok) {
      problems++;
      if (fix) out(`  → ${fix}`);
    }
  };
  const config = await readConfig().catch((error: unknown) => {
    check(
      false,
      `The configuration in ${configPath()} is invalid: ${String(error)}`,
    );
    return null;
  });
  check(
    Boolean(config),
    config ? `Registered as ${config.name}` : "Not registered",
    "lictory-runner register --url <server> --token <token>",
  );
  const gitVersion = await run("git", ["--version"]);
  check(
    gitVersion.code === 0,
    gitVersion.code === 0 ? gitVersion.stdout.trim() : "git is not installed",
    "Install git 2.30 or newer.",
  );
  if (!config) return void (process.exitCode = 1);
  const health = await fetch(`${config.url}/healthz`).then(
    (r) => r.ok,
    () => false,
  );
  check(
    health,
    `${config.url} ${health ? "answers" : "is unreachable"}`,
    "Check the address, DNS, proxies and that outbound HTTPS is allowed.",
  );
  const detected = await detectHarnesses(harnesses, config);
  try {
    const client = new RunnerClient(config.url, config.credential);
    const beat = await client.heartbeat({
      ...machineReport(config, detected),
      sessions: [],
    });
    check(true, "The runner credential is valid");
    const skew = beat ? Math.abs(Date.parse(beat.serverTime) - Date.now()) : 0;
    check(
      skew < 30_000,
      `Clock difference with the server: ${Math.round(skew / 1000)} s`,
      "Synchronize this machine's clock (NTP).",
    );
  } catch (error) {
    check(
      false,
      `The server refused the runner: ${error instanceof Error ? error.message : String(error)}`,
      "Register the runner again if it was revoked.",
    );
  }
  for (const id of ["claude-code", "codex", "lictory"]) {
    const found = detected.find((d) => d.id === id);
    out(
      `${found ? "✓" : "·"} ${id}${found ? ` ${found.version ?? ""}` : " not found"}`,
    );
  }
  if (!detected.some((d) => d.id !== "lictory"))
    out(
      "  → Install Claude Code or Codex to run those agents; the built-in harness needs Lictory Intelligence on the server.",
    );
  const work = workDirectory(config);
  await mkdir(work, { recursive: true }).catch(() => undefined);
  const writable = await access(work, constants.W_OK).then(
    () => true,
    () => false,
  );
  check(
    writable,
    `Work directory ${work} is ${writable ? "writable" : "not writable"}`,
  );
  if (config.isolation === "container") {
    const imageProblem = containerImageProblem(config);
    if (imageProblem) check(false, imageProblem);
    else if (pinnedImage(config.containerImage!))
      check(true, `Container image ${config.containerImage}`);
    else
      out(
        `! Container image ${config.containerImage} is not pinned by digest: pin it (image@sha256:…) in config.json so a moved tag cannot change what sessions run in.`,
      );
    const docker = await run("docker", [
      "version",
      "--format",
      "{{.Server.Version}}",
    ]);
    check(
      docker.code === 0,
      docker.code === 0
        ? `Docker ${docker.stdout.trim()}`
        : "Docker is not available",
      "Install Docker and give this account access, or register with --isolation host.",
    );
  }
  if (problems) process.exitCode = 1;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "register":
      return register(args);
    case "start":
      return start(args);
    case "status":
      return status();
    case "doctor":
      return doctor();
    case "install-service": {
      const { values } = parseArgs({
        args,
        options: { system: { type: "boolean" }, enable: { type: "boolean" } },
      });
      return installService({
        system: Boolean(values.system),
        enable: Boolean(values.enable),
        log: out,
      });
    }
    case "version":
    case "--version":
      return out(RUNNER_VERSION);
    default:
      out(usage);
      if (command && command !== "help" && command !== "--help")
        process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
