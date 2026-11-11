// `bun run verify`: the complete local verification sequence of AGENTS.md
// ("Required final CI verification") against this checkout, with the
// infrastructure it needs set up and torn down for you.
//
// It runs exactly the commands of the manual sequence, in order, with the
// same arguments, and streams their output unfiltered. Around them it:
// - starts a private PostgreSQL (wal_level=logical) and Mailpit with CI's
//   images and flags (scripts/verify.compose.yaml), under a project name of
//   its own on ports Docker picks, or uses the ones named by --postgres and
//   --mailpit;
// - creates a disposable database and points every variable of the manual
//   sequence at it (docs/operations/development.md), so migrations never
//   reach a development database;
// - picks a free E2E_PORT_OFFSET for the browser suite unless one is set;
// - runs `playwright install` without `--with-deps` (which needs root) only
//   when Chromium already launches here, which proves the system
//   dependencies are present;
// - always cleans up what it created (containers, the database and its
//   replication slots), also on failure and Ctrl-C, and prints a summary
//   with the command that reruns a failed step.
//
// Usage: bun run verify [--postgres <url>] [--mailpit <url> [--smtp host:port]]
//                       [--only <step,...> | --from <step>]
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import type Postgres from "postgres";
import { busyPorts } from "./e2e-ports";

const root = fileURLToPath(new URL("..", import.meta.url));
const composeFile = fileURLToPath(
  new URL("verify.compose.yaml", import.meta.url),
);

// The sequence of AGENTS.md, word for word (a test compares them).
const playwrightInstall = [
  "bunx",
  "playwright",
  "install",
  "--with-deps",
  "--only-shell",
  "chromium",
];
const steps = [
  { name: "install", command: ["bun", "install", "--frozen-lockfile"] },
  { name: "audit", command: ["bun", "audit", "--audit-level=high"] },
  { name: "check", command: ["bun", "run", "check"] },
  { name: "db:check", command: ["bun", "run", "db:check"] },
  { name: "db:migrate", command: ["bun", "run", "db:migrate"] },
  { name: "test:domain", command: ["bun", "run", "test:domain"] },
  { name: "playwright", command: playwrightInstall },
  { name: "test:e2e", command: ["bun", "run", "test:e2e"] },
];
type Step = (typeof steps)[number];

const usage = `Usage: bun run verify [options]

Runs the complete local verification sequence (AGENTS.md, "Required final CI
verification") against this checkout, with a private PostgreSQL and Mailpit
that are removed afterwards.

Options:
  --postgres <url>    Use this PostgreSQL instead of starting one: the URL of
                      its admin database, for example
                      postgresql://lictory:lictory@localhost:5432/postgres.
                      It needs wal_level=logical. A disposable database is
                      created in it and dropped afterwards.
  --mailpit <url>     Use this Mailpit instead of starting one: its web
                      address, for example http://localhost:8025.
  --smtp <host:port>  Its SMTP address (default: port 1025 on the same host).
  --only <steps>      Run only these steps, comma-separated (to rerun one).
  --from <step>       Run this step and every later one.
  -h, --help          Show this help.

Steps: ${steps.map((step) => step.name).join(", ")}

E2E_PORT_OFFSET, E2E_WORKERS and the rest of the environment reach the
steps unchanged. E2E_SHARD and E2E_SKIP_BUILD narrow the browser suite, so
a full run refuses them.`;

class UsageError extends Error {}

function parseArguments(args: string[]) {
  const options: {
    postgres?: string;
    mailpit?: string;
    smtp?: string;
    only?: string[];
    from?: string;
  } = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "-h" || arg === "--help") {
      console.log(usage);
      process.exit(0);
    }
    const [flag, inline] = arg.startsWith("--") ? arg.split(/=(.*)/s) : [arg];
    const take = () => {
      const value = inline ?? args[++index];
      if (!value) throw new UsageError(`${flag} needs a value.`);
      return value;
    };
    if (flag === "--postgres") options.postgres = take();
    else if (flag === "--mailpit") options.mailpit = take();
    else if (flag === "--smtp") options.smtp = take();
    else if (flag === "--only")
      options.only = [
        ...(options.only ?? []),
        ...take()
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      ];
    else if (flag === "--from") options.from = take();
    else throw new UsageError(`Unknown argument: ${arg}`);
  }
  const names = steps.map((step) => step.name);
  for (const name of [...(options.only ?? []), options.from ?? names[0]!])
    if (!names.includes(name))
      throw new UsageError(
        `Unknown step "${name}". Steps: ${names.join(", ")}.`,
      );
  if (options.only && options.from)
    throw new UsageError("Use either --only or --from, not both.");
  if (options.smtp && !options.mailpit)
    throw new UsageError("--smtp names the SMTP port of --mailpit.");
  return options;
}

let options: ReturnType<typeof parseArguments>;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(`${error.message}\n\n${usage}`);
  process.exit(2);
}
const selected = steps.filter((step, index) =>
  options.only
    ? options.only.includes(step.name)
    : index >= steps.findIndex((s) => s.name === (options.from ?? "install")),
);
const partial = selected.length < steps.length;
// The browser suite reads these to run one shard or reuse earlier builds:
// fine while iterating, never in the final verification of the working tree.
const narrowing = ["E2E_SHARD", "E2E_SKIP_BUILD"].filter(
  (name) => process.env[name],
);
if (narrowing.length && !partial) {
  console.error(
    `${narrowing.join(" and ")} would narrow the browser suite (one shard, or builds of an earlier tree). Unset ${narrowing.length > 1 ? "them" : "it"} for the full verification, or rerun single steps with --only.`,
  );
  process.exit(2);
}

// ------------------------------------------------------------- processes

// The step (or setup command) in the foreground. Each runs in a process
// group of its own, so an interruption reaches whatever its package-manager
// wrapper started, and is forwarded once: the step's own cleanup (the browser
// suite stops its services and drops its database) runs before ours.
let current: ChildProcess | undefined;
let currentGroup = false;
let interrupted: NodeJS.Signals | undefined;
let cleaning = false;

function signalCurrent(signal: NodeJS.Signals) {
  if (!current?.pid || current.exitCode !== null) return;
  try {
    if (currentGroup) process.kill(-current.pid, signal);
    else current.kill(signal);
  } catch {
    // Already gone.
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => {
    if (cleaning) {
      console.error(`\n${signal}: still cleaning up; please wait.`);
    } else if (!interrupted) {
      interrupted = signal;
      console.error(
        `\n${signal}: stopping the current step, then cleaning up. Press Ctrl-C again to stop the step at once.`,
      );
      signalCurrent(signal === "SIGHUP" ? "SIGTERM" : signal);
    } else {
      console.error(
        `\n${signal}: stopping the current step now; services it started may keep running.`,
      );
      signalCurrent("SIGKILL");
    }
  });

type Outcome = { code: number; output: string };

// Runs a command with the terminal's output. `capture` collects it instead
// (setup commands whose answer is parsed). `terminal` keeps the command in
// this process group, for a command that may ask for a password (sudo).
function run(
  command: string[],
  env: NodeJS.ProcessEnv,
  { capture = false, terminal = false } = {},
): Promise<Outcome> {
  if (interrupted && !cleaning)
    return Promise.resolve({ code: 130, output: "" });
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(command[0]!, command.slice(1), {
      cwd: root,
      env,
      stdio: capture
        ? ["ignore", "pipe", "pipe"]
        : [terminal ? "inherit" : "ignore", "inherit", "inherit"],
      detached: !terminal,
    });
    const collect = (chunk: Buffer) => (output += chunk.toString());
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    current = child;
    currentGroup = !terminal;
    child.on("error", (error) => {
      output += error.message;
      // Missing executable: no exit event follows.
      if (child.pid === undefined) finish(127);
    });
    // "close", not "exit": captured output is complete only once the
    // pipes have closed.
    child.on("close", (code, signal) =>
      finish(code ?? (signal === "SIGINT" ? 130 : 128 + 15)),
    );
    let done = false;
    function finish(code: number) {
      if (done) return;
      done = true;
      if (current === child) current = undefined;
      // A step that exits on its own after Ctrl-C still counts as stopped.
      resolve({ code: interrupted && code !== 0 ? 130 : code, output });
    }
  });
}

const shellWord = (word: string) =>
  /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
const shell = (command: string[]) => command.map(shellWord).join(" ");

function duration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

// ------------------------------------------------------------- services

// What runs after the steps, newest first; each reports what it removed.
const cleanups: { label: string; undo: () => Promise<string> }[] = [];
const notes: string[] = [];

const hex = () => randomBytes(4).toString("hex");
const hostAndPort = (address: string) => {
  const at = address.lastIndexOf(":");
  return { host: address.slice(0, at), port: Number(address.slice(at + 1)) };
};
const redact = (url: URL) =>
  `${url.hostname}:${url.port || 5432}${url.pathname}`;

function reachable(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(5000, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function startPrivateServices(names: string[]) {
  const project = `lictory-verify-${hex()}`;
  const described = names
    .map((name) => ({ postgres: "PostgreSQL", mailpit: "Mailpit" })[name])
    .join(" and ");
  const compose = ["docker", "compose", "-p", project, "-f", composeFile];
  const env = { ...process.env };
  const version = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  });
  if (version.status !== 0)
    throw new Error(
      "Docker with the Compose plugin is required to start PostgreSQL and Mailpit for the run" +
        (version.error ? ` (${version.error.message}).` : ".") +
        " Install Docker, or name running services with --postgres and --mailpit (see --help).",
    );
  const down = [...compose, "down", "--volumes", "--remove-orphans"];
  cleanups.push({
    label: `the private ${described}`,
    undo: async () => {
      const { code, output } = await run(down, env, { capture: true });
      if (code !== 0)
        throw new Error(`${output.trim()}\nRemove them with: ${shell(down)}`);
      return `Removed the private ${described} (Compose project ${project}) and their data.`;
    },
  });
  console.log(
    `Starting ${described} (Compose project ${project}, scripts/verify.compose.yaml)…`,
  );
  const up = await run(
    [...compose, "up", "--detach", "--wait", "--wait-timeout", "180", ...names],
    env,
  );
  if (up.code !== 0)
    throw new Error(
      interrupted
        ? `Interrupted (${interrupted}).`
        : `${described} did not start: \`${shell([...compose, "up", "--detach", "--wait", ...names])}\` exited ${up.code}.`,
    );
  const port = async (service: string, inner: number) => {
    const { code, output } = await run(
      [...compose, "port", service, String(inner)],
      env,
      { capture: true },
    );
    const address = output.trim().split("\n").at(-1) ?? "";
    if (code !== 0 || !/:\d+$/.test(address))
      throw new Error(
        `Docker did not report ${service}'s port ${inner}: ${output.trim()}`,
      );
    return hostAndPort(address);
  };
  const result: {
    adminUrl?: string;
    database?: string;
    smtp?: { host: string; port: number };
    mailpitUrl?: string;
  } = {};
  if (names.includes("postgres")) {
    const { port: postgresPort } = await port("postgres", 5432);
    const database = "lictory_verify";
    const created = await run(
      [
        ...compose,
        "exec",
        "-T",
        "postgres",
        "createdb",
        "-U",
        "lictory",
        database,
      ],
      env,
      { capture: true },
    );
    if (created.code !== 0)
      throw new Error(`Could not create ${database}: ${created.output.trim()}`);
    result.adminUrl = `postgresql://lictory:lictory@127.0.0.1:${postgresPort}/postgres`;
    result.database = database;
    notes.push(
      `PostgreSQL: private, 127.0.0.1:${postgresPort}, database ${database}.`,
    );
  }
  if (names.includes("mailpit")) {
    const smtp = await port("mailpit", 1025);
    const web = await port("mailpit", 8025);
    result.smtp = { host: "127.0.0.1", port: smtp.port };
    result.mailpitUrl = `http://127.0.0.1:${web.port}`;
    notes.push(
      `Mailpit: private, SMTP 127.0.0.1:${smtp.port}, web ${result.mailpitUrl}.`,
    );
  }
  return result;
}

async function adminClient(url: string) {
  let postgres: typeof Postgres;
  try {
    postgres = (await import("postgres")).default;
  } catch {
    throw new Error(
      "--postgres needs the repository's dependencies: run `bun install --frozen-lockfile` first.",
    );
  }
  return postgres(url, {
    max: 1,
    onnotice: () => undefined,
    connect_timeout: 10,
  });
}

// A disposable database in a PostgreSQL the developer runs. Only this
// database (and replication slots in it) is ours to remove; the schema and
// browser suites drop the databases they create themselves.
async function useExternalPostgres(adminUrl: string) {
  const url = new URL(adminUrl);
  const where = redact(url);
  const admin = await adminClient(adminUrl);
  try {
    const [setting] = await admin<{ wal_level: string }[]>`SHOW wal_level`;
    if (setting?.wal_level !== "logical")
      throw new Error(
        `PostgreSQL at ${where} runs with wal_level=${setting?.wal_level}; the browser suite needs wal_level=logical (zero-cache replicates from it). Start it as compose.yaml does, or leave out --postgres to use a private one.`,
      );
    const database = `lictory_verify_${hex()}`;
    await admin`CREATE DATABASE ${admin(database)}`;
    cleanups.push({
      label: `database ${database}`,
      undo: async () => {
        const sql = await adminClient(adminUrl);
        try {
          await sql`
            SELECT pg_terminate_backend(active_pid) FROM pg_replication_slots
            WHERE database = ${database} AND active_pid IS NOT NULL`;
          await sql`
            SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots
            WHERE database = ${database}`;
          await sql`DROP DATABASE IF EXISTS ${sql(database)} WITH (FORCE)`;
        } finally {
          await sql.end();
        }
        return `Dropped database ${database} and its replication slots at ${url.hostname}:${url.port || 5432}.`;
      },
    });
    notes.push(`PostgreSQL: ${where}, disposable database ${database}.`);
    return { adminUrl, database };
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith("PostgreSQL at"))
      error.message = `Could not use PostgreSQL at ${where}: ${error.message}`;
    throw error;
  } finally {
    await admin.end();
  }
}

async function useExternalMailpit(mailpit: string, smtpAddress?: string) {
  const web = new URL(mailpit);
  const smtp = smtpAddress
    ? hostAndPort(smtpAddress)
    : { host: web.hostname, port: 1025 };
  if (!smtp.host || !Number.isInteger(smtp.port))
    throw new UsageError(`--smtp needs host:port, not "${smtpAddress}".`);
  const info = await fetch(new URL("/api/v1/info", web), {
    signal: AbortSignal.timeout(10_000),
  }).then(
    (response) => response.ok,
    () => false,
  );
  if (!info)
    throw new Error(
      `Mailpit does not answer at ${web.origin}/api/v1/info; start it (\`docker compose up -d mailpit\`) or leave out --mailpit to use a private one.`,
    );
  if (!(await reachable(smtp.host, smtp.port)))
    throw new Error(
      `Nothing accepts SMTP at ${smtp.host}:${smtp.port}; pass Mailpit's SMTP address with --smtp host:port.`,
    );
  notes.push(`Mailpit: ${web.origin}, SMTP ${smtp.host}:${smtp.port}.`);
  return { smtp, mailpitUrl: web.origin };
}

async function startServices() {
  const missing = [
    ...(options.postgres ? [] : ["postgres"]),
    ...(options.mailpit ? [] : ["mailpit"]),
  ];
  const external = {
    ...(options.postgres ? await useExternalPostgres(options.postgres) : {}),
    ...(options.mailpit
      ? await useExternalMailpit(options.mailpit, options.smtp)
      : {}),
  };
  const services = {
    ...external,
    ...(missing.length ? await startPrivateServices(missing) : {}),
  };
  const database = new URL(services.adminUrl!);
  database.pathname = `/${services.database}`;
  // The variables of the manual sequence (docs/operations/development.md).
  // Exported values win over .env in every step, as in a shell.
  return {
    ...process.env,
    DATABASE_URL: database.toString(),
    DATABASE_URL_UNPOOLED: database.toString(),
    SCHEMA_TEST_DATABASE_URL: services.adminUrl!,
    BETTER_AUTH_URL: "http://localhost:3001",
    BETTER_AUTH_SECRET: "ci-only-secret-not-a-production-credential-32",
    RESEND_API_KEY: "",
    SMTP_HOST: services.smtp!.host,
    SMTP_PORT: String(services.smtp!.port),
    NEXT_TELEMETRY_DISABLED: "1",
    // The browser workflows read sent mail through Mailpit's API.
    MAILPIT_URL: services.mailpitUrl!,
    // db:migrate migrates DATABASE_URL, never a migration target that .env
    // might name.
    DATABASE_MIGRATION_TARGET: "local",
    DATABASE_MIGRATION_URL: "",
  } satisfies NodeJS.ProcessEnv;
}

// ------------------------------------------------------------- steps

type Result = {
  step: Step;
  status: "passed" | "failed" | "interrupted";
  code: number;
  ms: number;
  ran: string;
  note?: string;
};

// Launching Chromium proves both the browser and the libraries it needs
// are installed; Playwright names what is missing otherwise.
const launchProbe = `require("@playwright/test").chromium.launch({ timeout: 60000 })
  .then((browser) => browser.close())
  .then(() => process.exit(0), (error) => { console.error(error.message); process.exit(1); });`;
const withoutDeps = playwrightInstall.filter((word) => word !== "--with-deps");

async function installBrowser(env: NodeJS.ProcessEnv) {
  const probe = () => run(["node", "-e", launchProbe], env, { capture: true });
  let launch = await probe();
  if (launch.code !== 0 && launch.output.includes("Executable doesn't exist")) {
    // Only the browser is missing: download it, then look again.
    const download = await run(withoutDeps, env);
    if (download.code !== 0) return { ...download, ran: shell(withoutDeps) };
    launch = await probe();
    if (launch.code === 0)
      return {
        code: 0,
        ran: shell(withoutDeps),
        note: "Chromium was downloaded and launches: system dependencies present, --with-deps not needed.",
      };
  } else if (launch.code === 0) {
    const result = await run(withoutDeps, env);
    return {
      ...result,
      ran: shell(withoutDeps),
      note: "Chromium already launches here: system dependencies present, --with-deps not needed.",
    };
  }
  if (interrupted) return { code: 130, ran: shell(playwrightInstall) };
  const reason = launch.output.trim().split("\n")[0] ?? "";
  console.log(
    `Chromium does not launch yet (${reason}); installing it with its system dependencies, which may ask for your password.`,
  );
  const result = await run(playwrightInstall, env, { terminal: true });
  return { ...result, ran: shell(playwrightInstall) };
}

// Up to 2700, zero-cache's ports (4858 + 10 × offset) stay below 32768,
// where Linux starts handing out ports to outgoing connections, so a busy
// machine cannot take them from under the run.
async function e2eOffset(env: NodeJS.ProcessEnv) {
  if (env.E2E_PORT_OFFSET !== undefined) return undefined;
  for (let offset = 0; offset <= 2700; offset += 100)
    if (!(await busyPorts(offset)).length) {
      if (offset)
        console.log(
          `The browser suite's default ports are in use; using E2E_PORT_OFFSET=${offset}.`,
        );
      return offset;
    }
  return undefined;
}

async function runStep(step: Step, env: NodeJS.ProcessEnv): Promise<Result> {
  const started = Date.now();
  let outcome: { code: number; ran: string; note?: string };
  if (step.name === "playwright") outcome = await installBrowser(env);
  else {
    let stepEnv = env;
    let note: string | undefined;
    if (step.name === "test:e2e") {
      const offset = await e2eOffset(env);
      if (offset !== undefined) {
        stepEnv = { ...env, E2E_PORT_OFFSET: String(offset) };
        if (offset) note = `E2E_PORT_OFFSET=${offset} (default ports in use).`;
      }
    }
    outcome = {
      ...(await run(step.command, stepEnv)),
      ran: shell(step.command),
      note,
    };
  }
  return {
    step,
    ...outcome,
    ms: Date.now() - started,
    status:
      outcome.code === 0 ? "passed" : interrupted ? "interrupted" : "failed",
  };
}

// ------------------------------------------------------------- main

function revision() {
  const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (head.status !== 0) return "this checkout";
  const dirty = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  return `${head.stdout.trim()}${dirty ? " plus uncommitted changes" : ""}`;
}

function rerun(flag: "--only" | "--from", name: string) {
  const reuse = (["postgres", "mailpit", "smtp"] as const).flatMap((key) => {
    const value = options[key];
    if (!value) return [];
    // Summaries end up in shared logs: never print the password.
    if (key !== "postgres") return [`--${key}`, value];
    const url = new URL(value);
    if (url.password) url.password = "PASSWORD";
    return [`--${key}`, url.toString()];
  });
  return shell(["bun", "run", "verify", ...reuse, flag, name]);
}

console.log(
  `Verifying ${revision()}: ${selected.map((step) => step.name).join(", ")}.`,
);
const results: Result[] = [];
let setupError: Error | undefined;
let exitCode = 0;
try {
  const env = await startServices();
  for (const note of notes) console.log(note);
  for (const [index, step] of selected.entries()) {
    if (interrupted) break;
    console.log(
      `\n━━ [${index + 1}/${selected.length}] ${step.name}: ${shell(step.command)}`,
    );
    const result = await runStep(step, env);
    results.push(result);
    if (result.status !== "passed") break;
  }
} catch (error) {
  setupError = error instanceof Error ? error : new Error(String(error));
} finally {
  cleaning = true;
  const cleaned: string[] = [];
  const leftovers: string[] = [];
  for (const { label, undo } of cleanups.reverse())
    try {
      cleaned.push(await undo());
    } catch (error) {
      leftovers.push(
        `Could not remove ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

  console.log("\n━━ Verification summary");
  for (const note of notes) console.log(`  ${note}`);
  const width = Math.max(...steps.map((step) => step.name.length));
  for (const step of selected) {
    const result = results.find((r) => r.step === step);
    const status = result
      ? { passed: "PASS", failed: "FAIL", interrupted: "STOP" }[result.status]
      : "----";
    const time = result ? duration(result.ms).padStart(7) : "not run";
    const exit = result && result.code !== 0 ? `  (exit ${result.code})` : "";
    console.log(
      `  ${status}  ${step.name.padEnd(width)}  ${time}  ${result?.ran ?? shell(step.command)}${exit}`,
    );
    if (result?.note) console.log(`        ${result.note}`);
  }

  const failed = results.find((result) => result.status === "failed");
  if (setupError) {
    exitCode = interrupted ? 130 : 1;
    console.log(
      `\n${results.length ? "Verification stopped unexpectedly" : "The services could not be prepared, so no step ran"}:\n  ${setupError.message}`,
    );
  } else if (interrupted) {
    exitCode = 130;
    const stopped = results.at(-1)?.step ?? selected[results.length];
    console.log(`\nInterrupted (${interrupted}).`);
    if (stopped)
      console.log(
        `Continue from ${stopped.name}: ${rerun("--from", stopped.name)}`,
      );
  } else if (failed) {
    exitCode = 1;
    const index = selected.indexOf(failed.step);
    console.log(
      `\n${failed.step.name} failed: \`${failed.ran}\` exited ${failed.code}.`,
    );
    console.log(
      `Rerun this step:          ${rerun("--only", failed.step.name)}`,
    );
    if (index < selected.length - 1)
      console.log(
        `Rerun it and what follows: ${rerun("--from", failed.step.name)}`,
      );
  } else if (partial) {
    console.log(
      `\nThe selected steps passed. This was a partial run; the full sequence (bun run verify) must pass on the final changes before a pull request.`,
    );
  } else {
    console.log("\nEvery step of the verification sequence passed.");
  }
  for (const line of cleaned) console.log(line);
  for (const line of leftovers) console.error(line);
  // Resources left behind fail the run, even when every step passed.
  if (leftovers.length && exitCode === 0) exitCode = 1;
}
process.exit(exitCode);
