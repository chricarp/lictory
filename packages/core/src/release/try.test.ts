import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

// The laptop trial (deploy/try.sh) on a stubbed computer: GitHub and Docker
// are fakes that record their calls, so nothing here starts a container. The
// real images run in CI (tests/try, .github/actions/trial).

const repository = new URL("../../../../", import.meta.url).pathname;
const deploy = join(repository, "deploy");
const registry = "ghcr.io/chricarp";
const latest =
  "https://github.com/chricarp/lictory/releases/latest/download/release.env";

function releaseFile(version: string, digit = "1") {
  return [
    `LICTORY_VERSION=${version}`,
    `LICTORY_GIT_SHA=${"a".repeat(40)}`,
    "LICTORY_CHANNEL=stable",
    ...["API", "MARKETING", "PROXY", "MIGRATE", "OPS"].map(
      (key) =>
        `${key}_IMAGE=${registry}/lictory-${key.toLowerCase()}@sha256:${digit.repeat(64)}`,
    ),
    "",
  ].join("\n");
}

type Call = {
  args: string[];
  cwd: string;
  stdin: string;
  shell: Record<string, string | null>;
};

function fixture(t: TestContext) {
  const base = mkdtempSync(join(tmpdir(), "lictory-try-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const fake = join(base, "fake-bin");
  const calls = join(base, "calls.jsonl");
  const routes = join(base, "routes.json");
  const dir = join(base, "home", "lictory-try");
  mkdirSync(fake);
  writeFileSync(routes, "{}");
  const recorder = (name: string, body: string) =>
    writeFileSync(
      join(fake, name),
      // Bun would load the trial's .env from the working directory; the fakes
      // must see only what the script's shell passed.
      `#!/usr/bin/env -S bun --no-env-file
import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const admin = ${JSON.stringify(name)} === "docker" && args.some((arg) => arg.endsWith("/admin.js"));
const stdin = admin ? readFileSync(0, "utf8") : "";
const shell = Object.fromEntries(["LICTORY_VERSION", "HTTP_BINDING", "SMTP_HOST", "COMPOSE_PROJECT_NAME", "COMPOSE_FILE"].map((key) => [key, process.env[key] ?? null]));
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ name: ${JSON.stringify(name)}, args, cwd: process.cwd(), stdin, shell }) + "\\n");
${body}
`,
      { mode: 0o755 },
    );
  // GitHub serves the routes; a port answers when FAKE_BUSY_PORTS lists it
  // (curl exits 7 when nothing listens); the trial's own address is ready.
  recorder(
    "curl",
    `const url = args.find((arg) => /^https?:\\/\\//.test(arg));
const port = /^http:\\/\\/127\\.0\\.0\\.1:(\\d+)\\/$/.exec(url)?.[1];
if (port) process.exit((process.env.FAKE_BUSY_PORTS ?? "").split(" ").includes(port) ? 0 : 7);
if (url.endsWith("/readyz")) process.exit(0);
const route = JSON.parse(readFileSync(${JSON.stringify(routes)}, "utf8"))[url];
if (!route) process.exit(22);
writeFileSync(args[args.indexOf("-o") + 1], route);`,
  );
  // docker cp copies the file the release's ops image ships (this checkout's
  // deploy directory); the administrator command answers FAKE_ADMIN_STATUS.
  recorder(
    "docker",
    `if (args[0] === "version") console.log(process.env.FAKE_ENGINE_VERSION ?? "29.0.0");
else if (args[0] === "compose" && args[1] === "version") console.log(process.env.FAKE_COMPOSE_VERSION ?? "2.30.0");
else if (args[0] === "compose" && args.includes("down")) process.exit(Number(process.env.FAKE_CLEANUP_STATUS ?? 0));
else if (args[0] === "compose" && args[1] === "ps") { if (process.env.FAKE_ZERO_RUNNING) console.log("zero-container"); }
else if (args[0] === "compose" && args.includes("psql")) console.log(args.at(-1).includes("pg_current_wal_lsn") ? "0/1A2B3C4" : "t");
else if (args[0] === "info" && args.join(" ").includes("MemTotal")) console.log("8000000000");
else if (args[0] === "info" && args.join(" ").includes("OperatingSystem")) console.log(process.env.FAKE_OS ?? "Ubuntu 24.04.1 LTS");
else if (args[0] === "info") console.log(process.env.FAKE_ROOTLESS ? "[name=seccomp,profile=builtin name=rootless]" : "[name=seccomp,profile=builtin]");
else if (args[0] === "create") console.log("ops-container");
else if (args[0] === "cp") copyFileSync(${JSON.stringify(deploy)} + args[1].replace(/^ops-container:\\/opt\\/lictory\\/deploy/, ""), args[2]);
else if (admin) {
  const status = Number(process.env.FAKE_ADMIN_STATUS ?? 0);
  if (status === 0) console.log(JSON.stringify({ organization: { name: "Evaluation" }, url: "http://localhost/evaluation" }));
  process.exit(status);
}`,
  );
  const recorded = () => {
    const lines = existsSync(calls)
      ? readFileSync(calls, "utf8").trim().split("\n")
      : [];
    rmSync(calls, { force: true });
    return lines.map((line) => JSON.parse(line) as Call & { name: string });
  };
  // Only the host's basics: the trial reads LICTORY_* settings.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|USER|TMPDIR|LANG)$/.test(key),
    ),
  );
  return {
    dir,
    release(url: string, body: string) {
      const all = JSON.parse(readFileSync(routes, "utf8")) as Record<
        string,
        string
      >;
      all[url] = body;
      writeFileSync(routes, JSON.stringify(all));
    },
    command(command: string, extra: Record<string, string> = {}) {
      const result = spawnSync("sh", ["-c", command], {
        env: {
          ...environment,
          PATH: `${fake}:${process.env.PATH}`,
          COMPOSE_FILE: "/other/compose.yaml",
          COMPOSE_PROJECT_NAME: "other-project",
          ...extra,
        },
        cwd: base,
        encoding: "utf8",
      });
      return { ...result, calls: recorded() };
    },
    // Piped into sh, as the documentation runs it.
    run(extra: Record<string, string> = {}) {
      const result = spawnSync("sh", [], {
        input: readFileSync(join(deploy, "try.sh"), "utf8"),
        env: {
          ...environment,
          PATH: `${fake}:${process.env.PATH}`,
          HOME: join(base, "home"),
          ...extra,
        },
        cwd: base,
        encoding: "utf8",
      });
      return { ...result, calls: recorded() };
    },
  };
}

const env = (dir: string) =>
  Object.fromEntries(
    readFileSync(join(dir, ".env"), "utf8")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ]),
  ) as Record<string, string>;
const compose = (calls: (Call & { name: string })[]) =>
  calls
    .filter((call) => call.name === "docker" && call.args[0] === "compose")
    .filter((call) => call.args[1] !== "version")
    .map((call) => call.args.slice(1).join(" "));

void test("a first trial runs the release's own stack on http://localhost and creates the administrator", (t) => {
  const f = fixture(t);
  f.release(latest, releaseFile("0.24.0"));
  const result = f.run({ LICTORY_ADMIN_PASSWORD: "evaluation-secret" });
  assert.equal(result.status, 0, result.stderr);

  // The release's compose file, unchanged, plus the evaluation additions.
  assert.equal(
    readFileSync(join(f.dir, "compose.yaml"), "utf8"),
    readFileSync(join(deploy, "compose.production.yaml"), "utf8"),
  );
  assert.equal(
    readFileSync(join(f.dir, "postgres/10-lictory-roles.sh"), "utf8"),
    readFileSync(join(deploy, "postgres/10-lictory-roles.sh"), "utf8"),
  );
  const override = readFileSync(join(f.dir, "compose.override.yaml"), "utf8");
  assert.match(override, /^name: lictory-try$/m);
  assert.match(override, /image: axllent\/mailpit:v[\d.]+@sha256:[0-9a-f]{64}/);
  assert.match(override, /127\.0\.0\.1:\$\{LICTORY_TRY_MAIL_PORT:-8025\}:8025/);
  // The inbox holds password-reset links, so it asks for a password.
  assert.match(
    override,
    /MP_UI_AUTH: "lictory:\$\{LICTORY_TRY_MAIL_PASSWORD:\?/,
  );

  // Plain HTTP on this computer only, generated secrets, the release digests.
  const settings = env(f.dir);
  assert.equal(statSync(join(f.dir, ".env")).mode & 0o777, 0o600);
  assert.equal(settings.PLATFORM_URL, "http://localhost");
  assert.equal(settings.PROXY_SCHEME, "http");
  assert.equal(settings.HTTP_BINDING, "127.0.0.1:80:80");
  assert.equal(settings.HTTPS_BINDING, "127.0.0.1::443");
  assert.equal(settings.LICTORY_TRY_MAIL_PORT, "8025");
  assert.equal(settings.SMTP_HOST, "mailpit");
  assert.match(settings.LICTORY_TRY_MAIL_PASSWORD!, /^[0-9a-f]{20}$/);
  assert.equal(settings.LICTORY_SIGNUP_MODE, "invite");
  const secrets = [
    "POSTGRES_SUPERUSER_PASSWORD",
    "LICTORY_OWNER_PASSWORD",
    "LICTORY_APP_PASSWORD",
    "ZERO_DB_PASSWORD",
    "LICTORY_OPS_PASSWORD",
    "BETTER_AUTH_SECRET",
    "DELIVERY_CREDENTIALS_KEY",
    "ZERO_API_KEY",
    "ZERO_ADMIN_PASSWORD",
  ].map((key) => settings[key]!);
  for (const secret of secrets) assert.match(secret, /^[0-9a-f]{64}$/);
  assert.equal(new Set(secrets).size, secrets.length);
  assert.equal(settings.LICTORY_VERSION, "0.24.0");
  assert.equal(
    settings.API_IMAGE,
    `${registry}/lictory-api@sha256:${"1".repeat(64)}`,
  );

  // deploy.sh's order: database, roles, migrations, zero-cache, roles again
  // (grants on Zero's tables), then the services.
  const roles =
    "exec -T postgres sh /docker-entrypoint-initdb.d/10-lictory-roles.sh";
  assert.deepEqual(compose(result.calls), [
    "pull --quiet",
    "up -d --wait --wait-timeout 180 postgres mailpit",
    roles,
    "run --rm --no-deps -T migrate",
    // A new trial has no zero-cache yet: its initial sync replicates.
    "ps -q --status running zero-cache",
    "up -d --no-deps --wait --wait-timeout 900 zero-cache",
    roles,
    "up -d --no-deps --wait --wait-timeout 300 api worker collaboration proxy",
    "exec -T api node apps/api/dist/admin.js setup --organization Evaluation --name Lictory Admin --email admin@example.com --password-stdin --json",
  ]);
  // Every command on the stack runs in the trial's directory, where Compose
  // finds its files and .env (the version check runs before it exists).
  for (const call of result.calls.filter(
    (c) => c.args[0] === "compose" && c.args[1] !== "version",
  ))
    assert.equal(call.cwd, f.dir);
  // The password reaches the API on stdin only, and is printed to sign in.
  const admin = result.calls.find((call) =>
    call.args.includes("apps/api/dist/admin.js"),
  )!;
  assert.equal(admin.stdin, "evaluation-secret\n");
  assert.ok(!admin.args.includes("evaluation-secret"));
  assert.equal(
    readFileSync(join(f.dir, "administrator.txt"), "utf8"),
    "EMAIL=admin@example.com\nPASSWORD=evaluation-secret\n",
  );
  assert.equal(statSync(join(f.dir, "administrator.txt")).mode & 0o777, 0o600);
  assert.match(result.stdout, /running: http:\/\/localhost$/m);
  assert.match(result.stdout, /not for production/);
  assert.match(result.stdout, /evaluation-secret/);
  assert.match(
    result.stdout,
    new RegExp(`user lictory, password ${settings.LICTORY_TRY_MAIL_PASSWORD}`),
  );
  // Printed commands name the project, whatever the shell exports.
  assert.match(
    result.stdout,
    /docker compose -p lictory-try down --volumes --rmi all/,
  );
  assert.match(result.stdout, /docker compose -p lictory-try stop/);
  assert.doesNotMatch(result.stdout, /Docker Engine/);
  // Only the ops image's files are kept, not the image.
  assert.ok(
    result.calls.some(
      (call) => call.args[0] === "image" && call.args[1] === "rm",
    ),
  );
});

void test("taken ports and rootless Docker move the trial to free ports", (t) => {
  const f = fixture(t);
  f.release(latest, releaseFile("0.24.0"));
  const busy = f.run({ FAKE_BUSY_PORTS: "80 8025" });
  assert.equal(busy.status, 0, busy.stderr);
  assert.equal(env(f.dir).PLATFORM_URL, "http://localhost:8080");
  assert.equal(env(f.dir).HTTP_BINDING, "127.0.0.1:8080:80");
  assert.equal(env(f.dir).LICTORY_TRY_MAIL_PORT, "8026");
  assert.match(busy.stdout, /http:\/\/localhost:8026/);
  // A generated password, printed once and saved for the next run.
  const password = /^PASSWORD=(.+)$/m.exec(
    readFileSync(join(f.dir, "administrator.txt"), "utf8"),
  )![1]!;
  assert.match(password, /^[0-9a-f]{20}$/);

  const rootless = fixture(t);
  rootless.release(latest, releaseFile("0.24.0"));
  const result = rootless.run({ FAKE_ROOTLESS: "1" });
  assert.equal(result.status, 0, result.stderr);
  // Rootless Docker cannot publish port 80.
  assert.equal(env(rootless.dir).HTTP_BINDING, "127.0.0.1:8080:80");

  const taken = fixture(t);
  taken.release(latest, releaseFile("0.24.0"));
  const refused = taken.run({ LICTORY_TRY_PORT: "80", FAKE_BUSY_PORTS: "80" });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Port 80 is taken/);
  assert.deepEqual(compose(refused.calls), []);
});

void test("running the trial again keeps its secrets, data and edits and moves it to the newest release", (t) => {
  const f = fixture(t);
  f.release(latest, releaseFile("0.24.0"));
  assert.equal(f.run().status, 0);
  const first = env(f.dir);
  const credentials = readFileSync(join(f.dir, "administrator.txt"), "utf8");
  writeFileSync(
    join(f.dir, ".env"),
    readFileSync(join(f.dir, ".env"), "utf8") + "LICTORY_AI_CONSOLE=false\n",
  );

  f.release(latest, releaseFile("0.25.0", "2"));
  const again = f.run({
    FAKE_ADMIN_STATUS: "3",
    FAKE_BUSY_PORTS: "80",
    FAKE_ZERO_RUNNING: "1",
  });
  assert.equal(again.status, 0, again.stderr);
  const second = env(f.dir);
  for (const key of [
    "BETTER_AUTH_SECRET",
    "LICTORY_APP_PASSWORD",
    "HTTP_BINDING",
    "LICTORY_TRY_MAIL_PASSWORD",
  ])
    assert.equal(second[key], first[key], key);
  assert.equal(second.LICTORY_AI_CONSOLE, "false");
  assert.equal(second.LICTORY_VERSION, "0.25.0");
  assert.equal(
    second.OPS_IMAGE,
    `${registry}/lictory-ops@sha256:${"2".repeat(64)}`,
  );
  assert.equal(
    readFileSync(join(f.dir, ".env"), "utf8").match(/^API_IMAGE=/gm)?.length,
    1,
  );
  // The new release's migrations run, and the running zero-cache replicates
  // them (deploy.sh's wait_for_zero) before it and the services are replaced.
  const upgrade = compose(again.calls);
  const migrated = upgrade.indexOf("run --rm --no-deps -T migrate");
  assert.ok(migrated >= 0);
  assert.match(upgrade[migrated + 2]!, /psql .*SELECT pg_current_wal_lsn\(\)$/);
  assert.match(upgrade[migrated + 3]!, /confirmed_flush_lsn >= '0\/1A2B3C4'/);
  assert.equal(
    upgrade[migrated + 4],
    "up -d --no-deps --wait --wait-timeout 900 zero-cache",
  );
  // The administrator stays.
  assert.equal(
    readFileSync(join(f.dir, "administrator.txt"), "utf8"),
    credentials,
  );

  // The same release again: its deployment files are already here.
  const same = f.run({ FAKE_ADMIN_STATUS: "3" });
  assert.equal(same.status, 0, same.stderr);
  assert.ok(!same.calls.some((call) => call.args[0] === "pull"));

  // A trial from before the inbox had a password gets one.
  writeFileSync(
    join(f.dir, ".env"),
    readFileSync(join(f.dir, ".env"), "utf8").replace(
      /^LICTORY_TRY_MAIL_PASSWORD=.*\n/m,
      "",
    ),
  );
  assert.equal(f.run({ FAKE_ADMIN_STATUS: "3" }).status, 0);
  assert.match(env(f.dir).LICTORY_TRY_MAIL_PASSWORD!, /^[0-9a-f]{20}$/);
});

void test("a release file that is not digest-pinned starts nothing", (t) => {
  for (const file of [
    releaseFile("0.24.0").replace(
      /lictory-api@sha256:1+/,
      "lictory-api:latest",
    ),
    releaseFile("0.24.0").replace(
      `${registry}/lictory-proxy`,
      "docker.io/someone/lictory-proxy",
    ),
    `${releaseFile("0.24.0")}EXTRA_SETTING=1\n`,
  ]) {
    const f = fixture(t);
    f.release(latest, file);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /nothing was started/);
    assert.ok(
      !result.calls.some(
        (call) =>
          call.name === "docker" && ["pull", "create"].includes(call.args[0]!),
      ),
    );
    assert.ok(!existsSync(join(f.dir, ".env")));
  }
});

void test("the trial's settings win over variables exported in the shell", (t) => {
  const f = fixture(t);
  f.release(latest, releaseFile("0.24.0"));
  // An empty LICTORY_VERSION means the newest release; Compose would read it
  // as the stack's version and refuse to start.
  // An exported Compose project or file list would point the trial's
  // commands, and the printed removal, at another project.
  const result = f.run({
    LICTORY_VERSION: "",
    HTTP_BINDING: "0.0.0.0:80:80",
    SMTP_HOST: "smtp.example.com",
    COMPOSE_PROJECT_NAME: "lictory-production",
    COMPOSE_FILE: "/srv/lictory/compose.yaml",
  });
  assert.equal(result.status, 0, result.stderr);
  const stack = result.calls.filter(
    (call) => call.args[0] === "compose" && call.args[1] !== "version",
  );
  assert.ok(stack.length > 0);
  for (const call of stack)
    assert.deepEqual(
      call.shell,
      {
        LICTORY_VERSION: null,
        HTTP_BINDING: null,
        SMTP_HOST: null,
        COMPOSE_PROJECT_NAME: "lictory-try",
        COMPOSE_FILE: null,
      },
      call.args.join(" "),
    );
});

void test("a chosen version is downloaded by its tag, and old Compose is refused", (t) => {
  const f = fixture(t);
  f.release(
    "https://github.com/chricarp/lictory/releases/download/v0.23.1/release.env",
    releaseFile("0.23.1"),
  );
  const result = f.run({ LICTORY_VERSION: "0.23.1" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(env(f.dir).LICTORY_VERSION, "0.23.1");

  const old = fixture(t);
  old.release(latest, releaseFile("0.24.0"));
  const refused = old.run({ FAKE_COMPOSE_VERSION: "2.20.2" });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Compose 2\.24 or newer/);
});

void test("Docker Engine before 28 on Linux warns that the local network can reach the trial", (t) => {
  const f = fixture(t);
  f.release(latest, releaseFile("0.24.0"));
  const old = f.run({ FAKE_ENGINE_VERSION: "27.5.1" });
  assert.equal(old.status, 0, old.stderr);
  assert.match(
    old.stdout,
    /Docker Engine 27\.5\.1 lets computers on your local network/,
  );

  // Docker Desktop runs the engine in a VM: its ports stay on this computer.
  const desktop = fixture(t);
  desktop.release(latest, releaseFile("0.24.0"));
  const result = desktop.run({
    FAKE_ENGINE_VERSION: "27.5.1",
    FAKE_OS: "Docker Desktop",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /local network/);
});

void test("printed removal ignores a shell's Compose file and deletes saved credentials only after cleanup", (t) => {
  const f = fixture(t);
  f.release(latest, releaseFile("0.24.0"));
  const trial = f.run();
  assert.equal(trial.status, 0, trial.stderr);
  const command = /^  Remove +(.+)$/m.exec(trial.stdout)![1]!;
  const failed = f.command(command, { FAKE_CLEANUP_STATUS: "1" });
  assert.equal(failed.status, 1, failed.stderr);
  assert.ok(existsSync(join(f.dir, "administrator.txt")));
  assert.ok(existsSync(join(f.dir, ".env")));
  const removed = f.command(command);
  assert.equal(removed.status, 0, removed.stderr);
  const cleanup = removed.calls.find((call) => call.args.includes("down"))!;
  assert.equal(cleanup.cwd, f.dir);
  assert.equal(cleanup.shell.COMPOSE_FILE, null);
  assert.deepEqual(cleanup.args, [
    "compose",
    "-p",
    "lictory-try",
    "down",
    "--volumes",
    "--rmi",
    "all",
  ]);
  assert.ok(!existsSync(f.dir));
});

void test("the CI trial masks the inbox password before replaying success or failure output", (t) => {
  const base = mkdtempSync(join(tmpdir(), "lictory-trial-action-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, "deploy"));
  const action = readFileSync(
    join(repository, ".github/actions/trial/action.yml"),
    "utf8",
  );
  const script = action
    .split("      run: |\n")[1]!
    .split("    - name:")[0]!
    .replace(/^        /gm, "");
  for (const status of [0, 1, 2]) {
    const dir = join(base, `trial-${status}`);
    mkdirSync(dir);
    writeFileSync(
      join(base, "deploy/try.sh"),
      status === 2
        ? "echo 'failed before configuration' >&2; exit 2\n"
        : `#!/bin/sh
printf '%s\\n' 'HTTP_PORT=8080' 'LICTORY_TRY_MAIL_PORT=8025' 'LICTORY_TRY_MAIL_PASSWORD=inbox-secret' > "$LICTORY_TRY_DIR/.env"
echo 'inbox password inbox-secret'
exit ${status}
`,
    );
    const result = spawnSync("bash", ["-c", script], {
      cwd: base,
      env: {
        ...process.env,
        REGISTRY: "",
        RUNNER_TEMP: base,
        LICTORY_TRY_DIR: dir,
        GITHUB_OUTPUT: join(base, "outputs"),
      },
      encoding: "utf8",
    });
    assert.equal(result.status, status, result.stderr);
    const mask = result.stdout.indexOf("::add-mask::inbox-secret");
    const output = result.stdout.indexOf("inbox password inbox-secret");
    if (status === 2) {
      assert.match(result.stdout, /failed before configuration/);
      assert.equal(mask, -1);
    } else {
      assert.ok(mask >= 0 && output > mask, result.stdout);
    }
    assert.ok(!existsSync(join(base, "lictory-trial-output.log")));
  }
});
