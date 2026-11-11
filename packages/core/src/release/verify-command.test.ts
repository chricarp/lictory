import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import postgres from "postgres";

// `bun run verify` (scripts/verify.ts) on a stubbed machine: docker, bun,
// bunx and node are fakes that record their calls, so these tests prove the
// orchestration (order, environment, cleanup, interruption, the summary)
// without building or testing anything. The one real dependency is
// PostgreSQL, for the run that uses a developer's own server.

const repository = new URL("../../../../", import.meta.url).pathname;
const script = join(repository, "scripts/verify.ts");

// The commands of the manual sequence, as AGENTS.md and the runbook list them.
function documentedSequence(file: string) {
  const text = readFileSync(join(repository, file), "utf8");
  const block = [...text.matchAll(/```sh\n([\s\S]*?)```/g)]
    .map((match) => match[1]!)
    .find((body) => body.includes("bun install --frozen-lockfile"));
  assert.ok(block, `${file} lists the verification sequence`);
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^bunx? /.test(line));
}

type Call = {
  name: string;
  args: string[];
  env: Record<string, string | undefined>;
  signal?: string;
};

const recordedEnv = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "SCHEMA_TEST_DATABASE_URL",
  "DATABASE_MIGRATION_TARGET",
  "DATABASE_MIGRATION_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "RESEND_API_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "MAILPIT_URL",
  "NEXT_TELEMETRY_DISABLED",
  "E2E_PORT_OFFSET",
];

function fixture(t: TestContext, { docker = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), "lictory-verify-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, "bin");
  const calls = join(base, "calls.jsonl");
  mkdirSync(bin);
  // One recorder behind every name. FAKE_FAIL and FAKE_HANG pick a call by
  // its command line; FAKE_PROBE decides whether Chromium launches.
  const recorder = `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
const calls = ${JSON.stringify(calls)};
const name = basename(process.argv[1]);
const args = process.argv.slice(2);
const line = [name, ...args].join(" ");
const env = Object.fromEntries(${JSON.stringify(recordedEnv)}.map((key) => [key, process.env[key]]));
const record = (extra = {}) => appendFileSync(calls, JSON.stringify({ name, args, env, ...extra }) + "\\n");
record();
const matches = (setting) => setting && line.includes(setting);
if (name === "docker" && args[0] === "compose" && args.includes("port")) {
  const ports = { "postgres 5432": 40001, "mailpit 1025": 40002, "mailpit 8025": 40003 };
  console.log("127.0.0.1:" + ports[args.slice(-2).join(" ")]);
}
if (name === "node") {
  const installed = () => readFileSync(calls, "utf8").includes('"name":"bunx"');
  const probe = process.env.FAKE_PROBE ?? "ok";
  if (probe === "missing-deps") {
    console.error("browserType.launch: Host system is missing dependencies to run browsers.");
    process.exit(1);
  }
  if (probe === "missing-browser" && !installed()) {
    console.error("browserType.launch: Executable doesn't exist at /cache/chromium_headless_shell");
    process.exit(1);
  }
}
if (matches(process.env.FAKE_HANG)) {
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => { record({ signal }); process.exit(130); });
  setInterval(() => {}, 1000);
} else if (matches(process.env.FAKE_FAIL)) process.exit(1);
`;
  for (const name of ["bun", "bunx", "node", ...(docker ? ["docker"] : [])])
    writeFileSync(join(bin, name), recorder, { mode: 0o755 });

  const read = (): Call[] =>
    existsSync(calls)
      ? readFileSync(calls, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Call)
      : [];

  function start(args: string[], env: Record<string, string> = {}) {
    let output = "";
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repository,
      env: {
        HOME: process.env.HOME ?? base,
        TMPDIR: tmpdir(),
        // The fakes first; git (for the header) from the system. With
        // `docker: false` the system's docker must not be found either.
        PATH: docker ? `${bin}:/usr/bin:/bin` : bin,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const exited = new Promise<{ code: number | null; output: string }>(
      (resolve) => child.on("exit", (code) => resolve({ code, output })),
    );
    return { child, exited };
  }

  async function until(predicate: (calls: Call[]) => boolean) {
    const deadline = Date.now() + 30_000;
    while (!predicate(read())) {
      assert.ok(Date.now() < deadline, "the expected call never came");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  return { start, read, until };
}

const commandLine = (call: Call) => [call.name, ...call.args].join(" ");
const steps = (calls: Call[]) =>
  calls.filter((call) => call.name !== "docker" && call.name !== "node");

void test("runs the documented sequence in order against private services, then removes them", async (t) => {
  const machine = fixture(t);
  // A port of the browser suite's default set is taken: the run moves it.
  const taken = createTcpServer();
  await new Promise<void>((resolve) => {
    taken.once("error", () => resolve());
    taken.listen(3006, "127.0.0.1", () => resolve());
  });
  t.after(() => taken.close());

  const { code, output } = await machine.start([], {
    FAKE_PROBE: "missing-deps",
  }).exited;
  assert.equal(code, 0, output);
  const calls = machine.read();

  const documented = documentedSequence("AGENTS.md");
  assert.deepEqual(
    documentedSequence("docs/operations/development.md"),
    documented,
  );
  assert.deepEqual(steps(calls).map(commandLine), documented);

  // Every step sees the disposable database and the private services.
  for (const call of steps(calls)) {
    assert.equal(
      call.env.DATABASE_URL,
      "postgresql://lictory:lictory@127.0.0.1:40001/lictory_verify",
    );
    assert.equal(call.env.DATABASE_URL_UNPOOLED, call.env.DATABASE_URL);
    assert.equal(
      call.env.SCHEMA_TEST_DATABASE_URL,
      "postgresql://lictory:lictory@127.0.0.1:40001/postgres",
    );
    assert.equal(call.env.DATABASE_MIGRATION_TARGET, "local");
    assert.equal(call.env.DATABASE_MIGRATION_URL, "");
    assert.equal(call.env.SMTP_HOST, "127.0.0.1");
    assert.equal(call.env.SMTP_PORT, "40002");
    assert.equal(call.env.MAILPIT_URL, "http://127.0.0.1:40003");
    assert.equal(call.env.BETTER_AUTH_URL, "http://localhost:3001");
    assert.equal(
      call.env.BETTER_AUTH_SECRET,
      "ci-only-secret-not-a-production-credential-32",
    );
    assert.equal(call.env.RESEND_API_KEY, "");
    assert.equal(call.env.NEXT_TELEMETRY_DISABLED, "1");
  }
  const e2e = steps(calls).at(-1)!;
  const offset = Number(e2e.env.E2E_PORT_OFFSET);
  assert.ok(offset > 0 && offset % 100 === 0, `offset ${offset}`);
  assert.match(output, new RegExp(`E2E_PORT_OFFSET=${offset}`));

  // Services first, removed last, under one private project.
  const docker = calls.filter((call) => call.name === "docker");
  const up = docker.find((call) => call.args.includes("up"))!;
  const project = up.args[up.args.indexOf("-p") + 1]!;
  assert.match(project, /^lictory-verify-[0-9a-f]{8}$/);
  assert.ok(up.args.includes("--wait"));
  assert.ok(
    docker.some((call) =>
      commandLine(call).endsWith(
        "exec -T postgres createdb -U lictory lictory_verify",
      ),
    ),
  );
  const last = calls.at(-1)!;
  assert.equal(last.name, "docker");
  assert.deepEqual(last.args.slice(0, 3), ["compose", "-p", project]);
  assert.ok(last.args.includes("down") && last.args.includes("--volumes"));
  assert.ok(calls.indexOf(up) < calls.indexOf(steps(calls)[0]!));

  for (const name of ["install", "audit", "check", "test:e2e"])
    assert.match(output, new RegExp(`PASS {2}${name}`));
  assert.match(output, /Every step of the verification sequence passed/);
});

void test("skips --with-deps only when Chromium launches without it", async (t) => {
  const present = fixture(t);
  const launched = await present.start(["--only", "playwright"], {
    FAKE_PROBE: "ok",
  }).exited;
  assert.equal(launched.code, 0, launched.output);
  assert.deepEqual(steps(present.read()).map(commandLine), [
    "bunx playwright install --only-shell chromium",
  ]);
  assert.match(launched.output, /system dependencies present/);
  assert.match(launched.output, /partial run/);

  // Only the browser is missing: download it, then launch again.
  const download = fixture(t);
  const downloaded = await download.start(["--only", "playwright"], {
    FAKE_PROBE: "missing-browser",
  }).exited;
  assert.equal(downloaded.code, 0, downloaded.output);
  const calls = download.read();
  assert.deepEqual(steps(calls).map(commandLine), [
    "bunx playwright install --only-shell chromium",
  ]);
  assert.equal(calls.filter((call) => call.name === "node").length, 2);
});

void test("a failed step stops the sequence, still cleans up and says how to rerun it", async (t) => {
  const machine = fixture(t);
  const { code, output } = await machine.start([], {
    FAKE_FAIL: "bun run test:domain",
    E2E_PORT_OFFSET: "3800",
  }).exited;
  assert.equal(code, 1, output);
  const calls = machine.read();
  assert.deepEqual(steps(calls).map(commandLine).at(-1), "bun run test:domain");
  assert.ok(!calls.some((call) => commandLine(call).includes("playwright")));
  assert.ok(calls.at(-1)!.args.includes("down"));
  assert.match(output, /FAIL {2}test:domain/);
  assert.match(output, /---- {2}test:e2e +not run/);
  assert.match(output, /Rerun this step: +bun run verify --only test:domain/);
  assert.match(
    output,
    /Rerun it and what follows: bun run verify --from test:domain/,
  );
});

void test("Ctrl-C stops the running step first, then removes the services", async (t) => {
  const machine = fixture(t);
  const run = machine.start([], { FAKE_HANG: "bun run check" });
  await machine.until((calls) =>
    calls.some((call) => commandLine(call) === "bun run check"),
  );
  run.child.kill("SIGINT");
  const { code, output } = await run.exited;
  assert.equal(code, 130, output);
  const calls = machine.read();
  const stopped = calls.findIndex((call) => call.signal === "SIGINT");
  assert.ok(stopped > 0, "the step received the interruption");
  const down = calls.findIndex((call) => call.args.includes("down"));
  assert.ok(down > stopped, "services are removed after the step stopped");
  assert.ok(!calls.some((call) => commandLine(call) === "bun run db:check"));
  assert.match(output, /STOP {2}check/);
  assert.match(output, /Continue from check: bun run verify --from check/);
});

void test("explains what to do without Docker, and runs nothing", async (t) => {
  const machine = fixture(t, { docker: false });
  const { code, output } = await machine.start([]).exited;
  assert.equal(code, 1, output);
  assert.match(output, /Docker with the Compose plugin is required/);
  assert.match(output, /--postgres and --mailpit/);
  assert.deepEqual(steps(machine.read()), []);
});

void test("rejects an unknown step before starting anything", async (t) => {
  const machine = fixture(t);
  const { code, output } = await machine.start(["--only", "lint"]).exited;
  assert.equal(code, 2);
  assert.match(output, /Unknown step "lint"\. Steps: install, audit, check/);
  assert.deepEqual(machine.read(), []);
});

void test("with a developer's PostgreSQL and Mailpit, drops only its own database and slots", async (t) => {
  const adminUrl =
    process.env.SCHEMA_TEST_DATABASE_URL ??
    "postgresql://lictory:lictory@localhost:5432/postgres";
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  t.after(() => admin.end());
  const mailpit = createHttpServer((request, response) => {
    response.statusCode = request.url === "/api/v1/info" ? 200 : 404;
    response.end("{}");
  });
  const smtp = createTcpServer((socket) => socket.end());
  const listen = (server: Server | ReturnType<typeof createHttpServer>) =>
    new Promise<number>((resolve) =>
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      }),
    );
  const [webPort, smtpPort] = await Promise.all([
    listen(mailpit),
    listen(smtp),
  ]);
  t.after(() => {
    mailpit.close();
    smtp.close();
  });
  const args = [
    "--postgres",
    adminUrl,
    "--mailpit",
    `http://127.0.0.1:${webPort}`,
    "--smtp",
    `127.0.0.1:${smtpPort}`,
  ];

  const machine = fixture(t, { docker: false });
  const [{ wal_level }] = await admin<{ wal_level: string }[]>`SHOW wal_level`;
  if (wal_level !== "logical") {
    const { code, output } = await machine.start(args).exited;
    assert.equal(code, 1, output);
    assert.match(output, /needs wal_level=logical/);
    assert.deepEqual(steps(machine.read()), []);
    return;
  }

  const run = machine.start(args, { FAKE_HANG: "bun run db:migrate" });
  await machine.until((calls) =>
    calls.some((call) => commandLine(call) === "bun run db:migrate"),
  );
  const migrate = machine
    .read()
    .find((call) => commandLine(call) === "bun run db:migrate")!;
  const url = new URL(migrate.env.DATABASE_URL!);
  const database = url.pathname.slice(1);
  assert.match(database, /^lictory_verify_[0-9a-f]{8}$/);
  assert.equal(migrate.env.SCHEMA_TEST_DATABASE_URL, adminUrl);
  assert.equal(migrate.env.SMTP_PORT, String(smtpPort));
  assert.equal(migrate.env.MAILPIT_URL, `http://127.0.0.1:${webPort}`);

  // What zero-cache would leave behind if it were interrupted mid-run.
  const inside = postgres(url.toString(), {
    max: 1,
    onnotice: () => undefined,
  });
  const slot = `verify_test_${database.slice(-8)}`;
  await inside`SELECT pg_create_logical_replication_slot(${slot}, 'pgoutput')`;
  await inside.end();

  run.child.kill("SIGINT");
  const { code, output } = await run.exited;
  assert.equal(code, 130, output);
  assert.match(output, new RegExp(`Dropped database ${database}`));
  const [left] = await admin<{ databases: number; slots: number }[]>`
    SELECT
      (SELECT count(*)::int FROM pg_database WHERE datname = ${database}) AS databases,
      (SELECT count(*)::int FROM pg_replication_slots WHERE slot_name = ${slot}) AS slots`;
  assert.deepEqual(left, { databases: 0, slots: 0 });
  assert.ok(!machine.read().some((call) => call.name === "docker"));
});

void test("the private services use CI's images and PostgreSQL flags", () => {
  const action = readFileSync(
    join(repository, ".github/actions/services/action.yml"),
    "utf8",
  );
  const compose = readFileSync(
    join(repository, "scripts/verify.compose.yaml"),
    "utf8",
  );
  const images = (text: string) =>
    [
      ...text.matchAll(
        /(?:postgres|axllent\/mailpit):[\w.-]+@sha256:[0-9a-f]{64}/g,
      ),
    ]
      .map((match) => match[0])
      .sort();
  assert.deepEqual(images(compose), images(action));
  const flags = (text: string) =>
    [...text.matchAll(/-c\s+(?:- )?(\w+=\w+)/g)]
      .map((match) => match[1])
      .sort();
  assert.equal(flags(action).length, 7);
  assert.deepEqual(flags(compose), flags(action));
});
