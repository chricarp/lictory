#!/usr/bin/env bun
import { access, constants, mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import { parseArgs, type ParseArgsConfig } from "node:util";
import {
  NetworkError,
  ProtocolError,
  RunnerClient,
} from "@lictory/runner/client";
import {
  RUNNER_VERSION,
  configPath,
  homeDirectory,
  readConfig,
  readState,
  runnerLiveness,
  workDirectory,
  writeConfig,
  configSchema,
  containerImageProblem,
  pinnedImage,
  type RunnerConfig,
} from "@lictory/runner/config";
import {
  REVOKED_MESSAGE,
  STATE_STALE_MS,
  machineReport,
  refuseIfRunning,
  startDaemon,
} from "@lictory/runner/daemon";
import { fakeHarnesses, loadScript } from "@lictory/runner/harness/fake";
import { detectHarnesses, harnesses } from "@lictory/runner/harness/index";
import { CliError, EXIT, complain, say, when } from "@lictory/runner/output";
import { run } from "@lictory/runner/process";
import { installService, showLogs } from "@lictory/runner/service";

type Options = NonNullable<ParseArgsConfig["options"]>;

// Every command: its usage, what it does and its options, for
// `lictory-runner <command> --help` and `lictory-runner help <command>`.
const commands = {
  register: {
    summary: "Register this machine with a Lictory server",
    usage:
      "lictory-runner register --url <server> --token <registration token> [options]",
    about: [
      "Exchanges a one-time registration token from Factory → Runners → Add runner",
      "for this runner's credential, kept in the configuration file below (readable",
      "only by this account). The token works once and expires after an hour.",
    ],
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
    help: [
      [
        "--url <server>",
        "The address you open Lictory at, e.g. https://lictory.example.com",
      ],
      ["--token <token>", "The registration token (lrt_…)"],
      [
        "--name <name>",
        "How the runner is listed (default: this machine's host name)",
      ],
      ["--max-sessions <n>", "Sessions it runs at once, 1 to 64 (default 2)"],
      [
        "--isolation host|container",
        "Sessions in worktrees on this machine (default) or in Docker containers",
      ],
      [
        "--container-image <image@sha256:…>",
        "The image container isolation runs sessions in (needs git and the harnesses)",
      ],
      ["--label <label>", "A label shown on the runner; repeat for several"],
      ["--force", "Replace this machine's existing registration"],
    ],
  },
  start: {
    summary: "Connect and run agent sessions until stopped",
    usage: "lictory-runner start [--test-harness <script.json|default>]",
    about: [
      "Connects out to the server over HTTPS and runs the sessions it is assigned.",
      "Ctrl-C or SIGTERM stops claiming work and hands running sessions back to the",
      "queue. One runner runs per configuration directory: a second start is refused.",
    ],
    options: { "test-harness": { type: "string" } },
    help: [
      [
        "--test-harness <script.json|default>",
        "Replace every agent with a scripted one (tests: nothing real runs)",
      ],
    ],
  },
  status: {
    summary: "Show whether the runner runs and what it works on",
    usage: "lictory-runner status",
    about: [
      "Reads the state the running runner writes on every heartbeat; it does not",
      "contact the server (lictory-runner doctor does). For scripts: exits 0 while",
      `it runs, ${EXIT.failed} when it is stopped or not responding, and ${EXIT.needsPerson} when this machine`,
      "is not registered or the server refused its credential.",
    ],
    options: {},
    help: [],
  },
  doctor: {
    summary:
      "Check the server, the credential, git, harnesses, Docker and the clock",
    usage: "lictory-runner doctor",
    about: [
      "Runs every check and prints what to do about each failure. Exits 1 when a",
      "check fails.",
    ],
    options: {},
    help: [],
  },
  "install-service": {
    summary: "Keep the runner running as a systemd or launchd service",
    usage: "lictory-runner install-service [--system] [--enable]",
    about: [
      "Writes a systemd unit (Linux) or launchd agent (macOS) that runs",
      "`lictory-runner start` at boot and restarts it when it fails, but not when a",
      `person must act first (exit code ${EXIT.needsPerson}). On Windows it prints the Task Scheduler commands.`,
    ],
    options: { system: { type: "boolean" }, enable: { type: "boolean" } },
    help: [
      ["--system", "A system service (needs root) instead of your user's"],
      ["--enable", "Enable and start it now"],
    ],
  },
  logs: {
    summary: "Show the runner service's log",
    usage: "lictory-runner logs [--follow] [--lines <n>]",
    about: [
      "Prints the log of the service install-service set up: the systemd journal on",
      "Linux, the runner.log file launchd writes on macOS. A runner started by hand",
      "with `lictory-runner start` logs to its own terminal instead.",
    ],
    options: {
      follow: { type: "boolean", short: "f" },
      lines: { type: "string", short: "n" },
    },
    help: [
      ["-f, --follow", "Keep printing new lines until Ctrl-C"],
      ["-n, --lines <n>", "How many recent lines to show (default 100)"],
    ],
  },
  version: {
    summary: "Print the runner's version",
    usage: "lictory-runner version",
    about: [],
    options: {},
    help: [],
  },
} satisfies Record<
  string,
  {
    summary: string;
    usage: string;
    about: string[];
    options: Options;
    help: [string, string][];
  }
>;
type Command = keyof typeof commands;
const isCommand = (name: string | undefined): name is Command =>
  Boolean(name && Object.hasOwn(commands, name));

const footer = () => [
  `Configuration and credential: ${homeDirectory()} (LICTORY_RUNNER_HOME).`,
  "",
  `Exit codes: ${EXIT.ok} done; ${EXIT.failed} failed (a service restarts the runner);`,
  `${EXIT.needsPerson} a person must act first: not registered, or the credential was revoked`,
  `(a service does not restart it); ${EXIT.usage} wrong command line.`,
];

function overview() {
  const width = Math.max(...Object.keys(commands).map((c) => c.length));
  return [
    `lictory-runner ${RUNNER_VERSION}: runs Lictory agent sessions on this machine.`,
    "",
    "Usage: lictory-runner <command> [options]",
    "",
    ...Object.entries(commands).map(
      ([name, c]) => `  ${name.padEnd(width)}  ${c.summary}`,
    ),
    "",
    "Run `lictory-runner <command> --help` for a command's options.",
    "",
    ...footer(),
  ].join("\n");
}

function commandHelp(name: Command) {
  const c = commands[name];
  const options: [string, string][] = [
    ...c.help,
    ["-h, --help", "Show this help"],
  ];
  // Flags longer than this get their text on the next line.
  const width = Math.min(28, Math.max(...options.map(([flag]) => flag.length)));
  return [
    `Usage: ${c.usage}`,
    "",
    c.summary + ".",
    ...(c.about.length ? ["", ...c.about] : []),
    "",
    "Options:",
    ...options.map(([flag, text]) =>
      flag.length > width
        ? `  ${flag}\n      ${text}`
        : `  ${flag.padEnd(width)}  ${text}`,
    ),
    "",
    ...footer(),
  ].join("\n");
}

// Parses a command's options; --help/-h print its help instead.
function options<C extends Command>(name: C, args: string[]) {
  const asked = args.some((a) => a === "--help" || a === "-h");
  if (asked) {
    say(commandHelp(name));
    return null;
  }
  try {
    return parseArgs({
      args,
      options: commands[name].options,
      allowPositionals: false,
      strict: true,
    }).values as Record<string, string | string[] | boolean | undefined>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `${message.replace(/\.?$/, ".")} See \`lictory-runner ${name} --help\`.`,
      EXIT.usage,
    );
  }
}

const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;

function serverUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError(
      `--url ${value} is not an address. Give the address you open Lictory at, for example https://lictory.example.com.`,
      EXIT.usage,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new CliError(
      `--url must start with https:// (or http:// for a local server), not ${url.protocol}//.`,
      EXIT.usage,
    );
  return url.origin + url.pathname.replace(/\/$/, "");
}

async function register(args: string[]) {
  const values = options("register", args);
  if (!values) return;
  const url = text(values.url);
  const token = text(values.token);
  if (!url || !token)
    throw new CliError(
      "Give the server's address and a registration token: lictory-runner register --url <server> --token <token>. Create the token in Factory → Runners → Add runner.",
      EXIT.usage,
    );
  const maxSessions = text(values["max-sessions"]);
  if (
    maxSessions !== undefined &&
    !(/^\d+$/.test(maxSessions) && +maxSessions >= 1 && +maxSessions <= 64)
  )
    throw new CliError(
      `--max-sessions is a whole number from 1 to 64, not ${maxSessions}.`,
      EXIT.usage,
    );
  const isolation = text(values.isolation);
  if (
    isolation !== undefined &&
    isolation !== "host" &&
    isolation !== "container"
  )
    throw new CliError(
      `--isolation is host or container, not ${isolation}.`,
      EXIT.usage,
    );
  const existing = await readConfig();
  if (existing && !values.force)
    throw new CliError(
      `This machine is already registered as ${existing.name} with ${existing.url}. Pass --force to replace it.`,
    );
  const base = configSchema.parse({
    url: serverUrl(url),
    runnerId: "pending",
    organizationId: "pending",
    name: text(values.name) ?? hostname(),
    personal: false,
    credential: "pending",
    maxSessions: maxSessions ? Number(maxSessions) : undefined,
    isolation,
    containerImage: text(values["container-image"]),
    labels: Array.isArray(values.label) ? values.label : [],
  });
  const imageProblem = containerImageProblem(base);
  if (imageProblem) throw new CliError(imageProblem, EXIT.usage);
  const detected = await detectHarnesses(harnesses, base);
  const client = new RunnerClient(base.url, null);
  const registered = await client.register({
    ...machineReport(base, detected),
    token,
    name: base.name,
  });
  if (!registered)
    throw new CliError("The server did not answer the registration.");
  await writeConfig({
    ...base,
    runnerId: registered.runnerId,
    organizationId: registered.organizationId,
    name: registered.name,
    personal: registered.personal,
    credential: registered.credential,
  });
  say(
    `Registered ${registered.name} as ${registered.personal ? "a personal" : "an organization"} runner. Configuration: ${configPath()}`,
  );
  if (base.isolation === "host")
    say(
      "Sessions run directly on this machine as this account (isolation: host), with its files and credentials. To run each session in a container instead, register again with --isolation container --force.",
    );
  say(
    "Start it with `lictory-runner start`, or keep it running with `lictory-runner install-service --enable`.",
  );
}

async function required() {
  const config = await readConfig();
  if (!config)
    throw new CliError(
      "This machine is not registered. Run `lictory-runner register --url <server> --token <token>` first.",
      EXIT.needsPerson,
    );
  return config;
}

async function start(args: string[]) {
  const values = options("start", args);
  if (!values) return;
  const config = await required();
  await refuseIfRunning();
  const imageProblem = containerImageProblem(config);
  if (imageProblem) throw new CliError(imageProblem, EXIT.usage);
  const testScript =
    text(values["test-harness"]) ?? process.env.LICTORY_RUNNER_TEST_HARNESS;
  let available = harnesses;
  if (testScript) {
    say(
      "Using the scripted test harness for every agent: nothing real will run.",
    );
    available = fakeHarnesses(await loadScript(testScript));
  }
  await mkdir(workDirectory(config), { recursive: true });
  say(
    `lictory-runner ${RUNNER_VERSION}: ${config.name} connecting to ${config.url} (${config.isolation}, up to ${config.maxSessions} sessions).`,
  );
  const { revoked } = await startDaemon(config, { harnesses: available });
  if (revoked) process.exitCode = EXIT.needsPerson;
}

async function status(args: string[]) {
  if (!options("status", args)) return;
  const config = await readConfig();
  if (!config) {
    say(
      "Not registered. Register with: lictory-runner register --url <server> --token <token>",
    );
    process.exitCode = EXIT.needsPerson;
    return;
  }
  say(
    `${config.name} (${config.personal ? "personal" : "organization"} runner) at ${config.url}`,
  );
  const state = await readState();
  const liveness = runnerLiveness(state, { staleAfterMs: STATE_STALE_MS });
  if (state?.revoked && liveness === "stopped") {
    say(
      `Stopped: ${REVOKED_MESSAGE(config).replace(/ It exits with code.*$/, "")}`,
    );
    process.exitCode = EXIT.needsPerson;
    return;
  }
  if (!state || liveness === "stopped") {
    say(
      "Not running. Start it with `lictory-runner start` (or start its service).",
    );
    if (state?.lastError) say(`Last error: ${state.lastError}`);
    process.exitCode = EXIT.failed;
    return;
  }
  if (liveness === "unresponsive") {
    say(
      `Not responding: pid ${state.pid} last wrote its state ${when(state.updatedAt ?? state.startedAt)}.`,
    );
    say(
      "It may be stuck. Check its log (`lictory-runner logs` for the service), or stop that process and start the runner again.",
    );
    process.exitCode = EXIT.failed;
    return;
  }
  say(
    `Running (pid ${state.pid}) since ${when(state.startedAt)}. Last heartbeat: ${state.lastHeartbeatAt ? when(state.lastHeartbeatAt) : "none yet"}.`,
  );
  if (state.lastError) say(`Last error: ${state.lastError}`);
  if (!state.sessions.length) say("No sessions.");
  for (const s of state.sessions)
    say(`  ${s.state.padEnd(9)} ${s.harness.padEnd(12)} ${s.title}`);
}

const claudeModes: Record<RunnerConfig["claudePermissionMode"], string> = {
  default: "asks a person before edits and commands",
  acceptEdits: "edits files without asking, asks a person before commands",
  plan: "plans only and changes nothing",
  bypassPermissions: "runs every tool without asking anyone",
};
const codexSandboxes: Record<RunnerConfig["codexSandbox"], string> = {
  "read-only": "may only read files",
  "workspace-write": "may write only in the session's worktree",
  "danger-full-access": "may change anything this account can",
};

// What agents may do on this machine without asking, from config.json
// (claudePermissionMode, codexSandbox, isolation).
function posture(config: RunnerConfig) {
  return [
    config.isolation === "container"
      ? `Isolation container: sessions run in ${config.containerImage ?? "(no image set)"}, network ${config.containerNetwork}`
      : "Isolation host: sessions run on this machine as this account, with its files and credentials",
    `Claude Code permission mode ${config.claudePermissionMode}: ${claudeModes[config.claudePermissionMode]}`,
    `Codex sandbox ${config.codexSandbox}: ${codexSandboxes[config.codexSandbox]}`,
  ];
}

async function doctor(args: string[]) {
  if (!options("doctor", args)) return;
  let problems = 0;
  // A word next to each mark, so a failing line reads as one without the
  // glyph (screen readers name it differently, logs may lose it).
  const check = (ok: boolean, line: string, fix?: string) => {
    say(`${ok ? "✓ ok  " : "✗ FAIL"} ${line}`);
    if (!ok) {
      problems++;
      if (fix) say(`  → ${fix}`);
    }
  };
  const config = await readConfig().catch((error: unknown) => {
    check(
      false,
      `The configuration in ${configPath()} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      "Fix the file, or register again with --force.",
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
  // Not registered: a person must act first, the same code status and
  // start use.
  if (!config) return void (process.exitCode = EXIT.needsPerson);
  const detected = await detectHarnesses(harnesses, config);
  try {
    const client = new RunnerClient(config.url, config.credential);
    const beat = await client.heartbeat({
      ...machineReport(config, detected),
      sessions: [],
    });
    check(true, `${config.url} answers`);
    check(true, "The runner credential is valid");
    const skew = beat ? Math.abs(Date.parse(beat.serverTime) - Date.now()) : 0;
    check(
      skew < 30_000,
      `Clock difference with the server: ${Math.round(skew / 1000)} s`,
      "Synchronize this machine's clock (NTP).",
    );
  } catch (error) {
    if (error instanceof NetworkError)
      check(
        false,
        error.message,
        "The credential is checked once the server answers.",
      );
    else {
      const refused = error instanceof ProtocolError && error.status === 401;
      check(true, `${config.url} answers`);
      // A refused credential is said once, with what to do.
      if (refused)
        check(
          false,
          REVOKED_MESSAGE(config).replace(/ It exits with code.*$/, ""),
        );
      else
        check(
          false,
          `The server refused the runner: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  }
  for (const id of ["claude-code", "codex", "lictory"]) {
    const found = detected.find((d) => d.id === id);
    if (!found) {
      say(`· info ${id} not found`);
      continue;
    }
    const name = `${id} ${found.version ?? ""}`.trim();
    // In a container the harness signs in inside the image, not here.
    if (!found.harness.ready || config.isolation === "container") {
      say(
        `✓ ok   ${name}${found.harness.ready ? " (sign-in is not checked here: sessions run in the container image)" : ""}`,
      );
      continue;
    }
    const readiness = await found.harness.ready(config);
    if (readiness.state === "ready")
      check(true, `${name}, ${readiness.detail}`);
    else if (readiness.state === "not-ready")
      check(false, `${name} ${readiness.detail}`, readiness.fix);
    else {
      say(`! warn ${name} ${readiness.detail}`);
      say(`  → ${readiness.fix}`);
    }
  }
  if (!detected.some((d) => d.id !== "lictory"))
    say(
      "  → Install Claude Code or Codex to run those agents; the built-in harness needs Lictory Intelligence on the server.",
    );
  for (const line of posture(config)) say(`· info ${line}`);
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
      say(
        `! warn Container image ${config.containerImage} is not pinned by digest: pin it (image@sha256:…) in config.json so a moved tag cannot change what sessions run in.`,
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
  if (problems) process.exitCode = EXIT.failed;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "register":
      return register(args);
    case "start":
      return start(args);
    case "status":
      return status(args);
    case "doctor":
      return doctor(args);
    case "install-service": {
      const values = options("install-service", args);
      if (!values) return;
      return installService({
        system: Boolean(values.system),
        enable: Boolean(values.enable),
        log: say,
      });
    }
    case "logs": {
      const values = options("logs", args);
      if (!values) return;
      const lines = text(values.lines) ?? "100";
      if (!/^\d+$/.test(lines) || +lines < 1)
        throw new CliError(
          `--lines is a whole number of lines, not ${lines}.`,
          EXIT.usage,
        );
      process.exitCode = await showLogs({
        follow: Boolean(values.follow),
        lines: Number(lines),
        log: complain,
      });
      return;
    }
    case "version":
    case "--version":
    case "-v":
      if (command === "version" && !options("version", args)) return;
      return say(RUNNER_VERSION);
    case undefined:
    case "help":
    case "--help":
    case "-h": {
      const topic = command === "help" ? args[0] : undefined;
      if (topic === undefined) return say(overview());
      if (isCommand(topic)) return say(commandHelp(topic));
      throw new CliError(
        `There is no command ${topic}. Commands: ${Object.keys(commands).join(", ")}.`,
        EXIT.usage,
      );
    }
    default:
      complain(`Unknown command ${command}.\n`);
      complain(overview());
      process.exitCode = EXIT.usage;
  }
}

main().catch((error: unknown) => {
  complain(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof CliError ? error.code : EXIT.failed;
});
