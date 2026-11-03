import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  symlinkSync,
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

// The server tooling with an operator's own layout: a root other than
// /srv/lictory, an environment called qa and a registry other than GHCR.

const repository = new URL("../../../../", import.meta.url).pathname;
const deploy = join(repository, "deploy");
const registry = "registry.example.test:5000/platform";
const digest = (n: number) => `@sha256:${String(n).repeat(64).slice(0, 64)}`;
const images = ["API", "MARKETING", "PROXY", "MIGRATE", "OPS"];

function release(prefix = registry) {
  return [
    "LICTORY_VERSION=3.0.0",
    "LICTORY_GIT_SHA=local",
    "LICTORY_CHANNEL=nightly",
    ...images.map(
      (key, i) =>
        `${key}_IMAGE=${prefix}/lictory-${key.toLowerCase()}${digest(i + 1)}`,
    ),
    "",
  ].join("\n");
}

function fixture(t: TestContext) {
  const base = mkdtempSync(join(tmpdir(), "lictory-portable-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "opt", "lictory");
  const fake = join(base, "fake-bin");
  mkdirSync(fake, { recursive: true });
  mkdirSync(join(root, "qa"), { recursive: true });
  // Installed layout: deploy.sh and the host tools side by side in <root>/bin.
  cpSync(join(deploy, "bin"), join(root, "bin"), { recursive: true });
  cpSync(join(deploy, "deploy.sh"), join(root, "bin/deploy.sh"));
  writeFileSync(
    join(root, "qa", ".env"),
    `LICTORY_RELEASE_CHANNEL=nightly\nLICTORY_IMAGE_REGISTRY=${registry}\n`,
  );
  // Records every Docker call; answers just enough for prepare to succeed.
  writeFileSync(
    join(fake, "docker"),
    `#!/usr/bin/env bun
import { appendFileSync, cpSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(base, "calls.jsonl"))}, JSON.stringify(args) + "\\n");
const adapted = { apps: { http: { servers: { srv0: {
  trusted_proxies: { source: "static" }, trusted_proxies_strict: 1,
  protocols: ["h1", "h2"], read_header_timeout: 15000000000, idle_timeout: 300000000000,
} } } } };
if (args[0] === "create") console.log("bundle-container");
else if (args[0] === "cp") cpSync(${JSON.stringify(deploy)}, args.at(-1), { recursive: true });
else if (args[0] === "run") process.stdout.write(JSON.stringify(adapted));
else if (args[0] === "compose" && args.includes("--status")) console.log("Pending migrations: 1");
else if (args[0] === "compose" && args.includes("config"))
  console.log(JSON.stringify({ services: { proxy: { image: "proxy", environment: { CADDY_TRUSTED_PROXIES: "" } } } }));
`,
    { mode: 0o700 },
  );
  const run = (
    script: string,
    args: string[],
    options: { input?: string; env?: Record<string, string> } = {},
  ) => {
    const path = script.startsWith("provision/")
      ? join(deploy, script)
      : join(root, "bin", script.replace(/^bin\//, ""));
    const result = spawnSync("bash", [path, ...args], {
      env: {
        ...process.env,
        PATH: `${fake}:${process.env.PATH}`,
        LICTORY_ROOT: root,
        ...options.env,
      },
      input: options.input ?? "",
      encoding: "utf8",
    });
    const log = join(base, "calls.jsonl");
    const calls = existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[])
      : [];
    rmSync(log, { force: true });
    return { ...result, calls };
  };
  return { base, root, run };
}

void test("deploy.sh prepares a qa release from a non-GHCR registry under a custom root", (t) => {
  const f = fixture(t);
  const result = f.run("deploy.sh", ["qa", "prepare"], { input: release() });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "3.0.0\n");
  assert.ok(existsSync(join(f.root, "qa/releases/3.0.0/release.env")));
  const pulled = result.calls
    .filter((call) => call[0] === "pull")
    .map((call) => call.at(-1));
  assert.ok(pulled.length > 0);
  for (const image of pulled) assert.ok(image!.startsWith(`${registry}/`));
  const compose = result.calls.find((call) => call[0] === "compose")!;
  assert.equal(compose[compose.indexOf("--project-name") + 1], "lictory-qa");
  assert.equal(
    compose[compose.indexOf("--project-directory") + 1],
    join(f.root, "qa"),
  );
  assert.equal(
    compose[compose.indexOf("--env-file") + 1],
    join(f.root, "qa/.env"),
  );
});

void test("deploy.sh still requires digests from the environment's registry", (t) => {
  const f = fixture(t);
  const result = f.run("deploy.sh", ["qa", "prepare"], {
    input: release("ghcr.io/someone-else"),
  });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /must be a digest in registry\.example\.test:5000\/platform/,
  );
  assert.ok(!result.calls.some((call) => call[0] === "pull"));
});

void test("environment names are validated and must be configured on the server", (t) => {
  const f = fixture(t);
  for (const name of ["staging", "../qa", "QA", "test", "local", "preview"]) {
    for (const script of ["deploy.sh", "bin/lictory-compose"]) {
      const result = f.run(script, [name, "status"]);
      assert.equal(
        result.status,
        script === "deploy.sh" || name !== "staging" ? 64 : 1,
        `${script} ${name}`,
      );
      assert.deepEqual(result.calls, []);
    }
  }
  // An unconfigured name (a typo) creates nothing.
  assert.ok(!existsSync(join(f.root, "staging")));
  assert.equal(
    f.run("deploy.sh", ["qa", "status"]).stdout,
    "No active release.\n",
  );
});

void test("the release key logs in to the registry of the environment", (t) => {
  const f = fixture(t);
  const login = (environment: string) =>
    f.run("bin/lictory-remote", [], {
      input: "ci-robot$platform\ntest-only-token\n",
      env: { SSH_ORIGINAL_COMMAND: `${environment} registry-login` },
    });
  const qa = login("qa");
  assert.equal(qa.status, 0, qa.stderr);
  assert.deepEqual(qa.calls, [
    [
      "login",
      "registry.example.test:5000",
      "--username",
      "ci-robot$platform",
      "--password-stdin",
    ],
  ]);
  const logout = f.run("bin/lictory-remote", [], {
    env: { SSH_ORIGINAL_COMMAND: "qa registry-logout" },
  });
  assert.deepEqual(logout.calls, [["logout", "registry.example.test:5000"]]);

  // Without LICTORY_IMAGE_REGISTRY the default stays GHCR.
  mkdirSync(join(f.root, "production"));
  writeFileSync(
    join(f.root, "production/.env"),
    "LICTORY_RELEASE_CHANNEL=stable\n",
  );
  assert.equal(login("production").calls[0]![1], "ghcr.io");

  // Unconfigured or reserved environments are refused before any Docker call.
  for (const environment of ["staging", "test", "../qa"]) {
    const refused = login(environment);
    assert.equal(refused.status, 64);
    assert.deepEqual(refused.calls, []);
  }
});

void test("new-environment.sh creates a qa environment under a custom root", (t) => {
  const f = fixture(t);
  const result = f.run("provision/new-environment.sh", ["eu-qa"], {
    env: { LICTORY_IMAGE_REGISTRY: registry },
  });
  assert.equal(result.status, 0, result.stderr);
  const file = join(f.root, "eu-qa/.env");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const env = readFileSync(file, "utf8");
  assert.match(env, /^LICTORY_ENVIRONMENT=eu-qa$/m);
  assert.match(env, new RegExp(`^LICTORY_HOME=${join(f.root, "eu-qa")}$`, "m"));
  assert.match(env, /^LICTORY_RELEASE_CHANNEL=nightly$/m);
  assert.match(env, new RegExp(`^LICTORY_IMAGE_REGISTRY=${registry}$`, "m"));
  assert.match(env, /^BETTER_AUTH_SECRET=[0-9a-f]{64}$/m);
  assert.doesNotMatch(env, /=generate$/m);
  assert.doesNotMatch(env, /^[A-Z_]+=.*\/srv\/lictory/m);

  // The defaults are unchanged for production.
  assert.equal(f.run("provision/new-environment.sh", ["production"]).status, 0);
  const production = readFileSync(join(f.root, "production/.env"), "utf8");
  assert.match(production, /^LICTORY_ENVIRONMENT=production$/m);
  assert.match(production, /^LICTORY_RELEASE_CHANNEL=stable$/m);
  assert.match(
    production,
    /^LICTORY_IMAGE_REGISTRY=ghcr\.io\/replace-with-owner$/m,
  );

  assert.equal(f.run("provision/new-environment.sh", ["test"]).status, 64);
  assert.ok(!existsSync(join(f.root, "test")));
});

for (const [target, backedUp] of [
  ["", true],
  ["s3", true],
  ["none", false],
] as const) {
  void test(`pre-deploy backup with BACKUP_TARGET=${target || "unset"}: ${backedUp ? "taken" : "skipped with a warning"}`, (t) => {
    const f = fixture(t);
    if (target)
      writeFileSync(join(f.root, "qa/.env"), `BACKUP_TARGET=${target}\n`, {
        flag: "a",
      });
    assert.equal(
      f.run("deploy.sh", ["qa", "prepare"], { input: release() }).status,
      0,
    );
    symlinkSync("releases/3.0.0", join(f.root, "qa/current"));
    const result = f.run("deploy.sh", ["qa", "migrate", "3.0.0"]);
    assert.equal(result.status, 0, result.stderr);
    const backup = result.calls.some((call) => call.includes("backup.sh"));
    assert.equal(backup, backedUp);
    if (!backedUp)
      assert.match(result.stderr, /no pre-deploy backup: backups are disabled/);
  });
}

void test("PLATFORM_URL must be an exact origin before the proxy is validated", (t) => {
  const f = fixture(t);
  const env = join(f.root, "qa/.env");
  const base = readFileSync(env, "utf8");
  for (const url of [
    "https://lictory.example.test/",
    "https://lictory.example.test/lictory",
    "https://Lictory.example.test",
    "lictory.example.test",
  ]) {
    writeFileSync(env, `${base}PLATFORM_URL=${url}\n`);
    const result = f.run("deploy.sh", ["qa", "prepare"], { input: release() });
    assert.notEqual(result.status, 0, url);
    assert.match(result.stderr, /PLATFORM_URL must be an origin/);
    assert.ok(!result.calls.some((call) => call[0] === "run"));
  }
  for (const url of ["http://10.0.0.5:8080", "https://lictory.example.test"]) {
    writeFileSync(env, `${base}PLATFORM_URL=${url}\n`);
    rmSync(join(f.root, "qa/releases"), { recursive: true, force: true });
    const result = f.run("deploy.sh", ["qa", "prepare"], { input: release() });
    assert.equal(result.status, 0, result.stderr);
  }
});
