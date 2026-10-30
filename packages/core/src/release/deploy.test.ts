import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

const repository = new URL("../../../../", import.meta.url).pathname;
const peers = "192.0.2.10 2001:db8::/32";
const globalOptions = "acme_ca https://acme.example.test/directory\n\tdebug";
const sentinel = "synthetic-private-env-value";
const serverDefaults = {
  trusted_proxies: { source: "static", ranges: peers.split(" ") },
  trusted_proxies_strict: 1,
  protocols: ["h1", "h2"],
  read_header_timeout: 15000000000,
  idle_timeout: 300000000000,
};

function release(version: string) {
  return [
    `LICTORY_VERSION=${version}`,
    "LICTORY_GIT_SHA=local",
    "LICTORY_CHANNEL=stable",
    ...["API", "MARKETING", "PROXY", "MIGRATE", "OPS"].map(
      (key) =>
        `${key}_IMAGE=example.test/lictory-${key.toLowerCase()}:${version}`,
    ),
    "",
  ].join("\n");
}

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "lictory-deploy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "production");
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(join(root, "tmp"));
  mkdirSync(join(home, "postgres"), { recursive: true });
  cpSync(join(repository, "deploy/deploy.sh"), join(bin, "deploy.sh"));
  cpSync(
    join(repository, "deploy/bin/lictory-compose"),
    join(bin, "lictory-compose"),
  );
  writeFileSync(
    join(home, ".env"),
    "LICTORY_ALLOW_LOCAL_IMAGES=true\nLICTORY_RELEASE_CHANNEL=stable\n",
  );
  writeFileSync(join(home, "postgres/10-lictory-roles.sh"), "original");
  for (const version of ["1.0.0", "2.0.0"]) {
    const dir = join(home, "releases", version);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "release.env"), release(version));
  }
  symlinkSync("releases/2.0.0", join(home, "current"));
  writeFileSync(
    join(home, "release-history.log"),
    "yesterday activated 1.0.0\ntoday activated 2.0.0\n",
  );
  const writeJson = (name: string, value: unknown) =>
    writeFileSync(join(root, name), JSON.stringify(value));
  writeJson("adapted.json", {
    apps: { http: { servers: { srv0: serverDefaults } } },
  });
  writeJson("environment.json", {
    APP_HOST: "app.example.test",
    CADDY_TRUSTED_PROXIES: peers,
    CADDY_GLOBAL_OPTIONS: globalOptions,
  });
  // Exercise the real controller and Compose wrapper without touching Docker's
  // running stack. Docker failures stand in for Caddy rejecting a configuration.
  writeFileSync(
    join(bin, "docker"),
    `#!/usr/bin/env bun
import { appendFileSync, cpSync, readFileSync } from "node:fs";
const root = process.env.LICTORY_ROOT;
const args = process.argv.slice(2);
appendFileSync(root + "/calls.jsonl", JSON.stringify(args) + "\\n");
if (args[0] === "create") console.log("bundle-container");
else if (args[0] === "cp") cpSync(${JSON.stringify(join(repository, "deploy"))}, args.at(-1), { recursive: true });
else if (args[0] === "compose") {
  if (args.includes("config")) {
    if (process.env.FAIL_COMPOSE) {
      console.error(${JSON.stringify(sentinel)});
      process.exit(1);
    }
    const file = args[args.indexOf("--file") + 1];
    const version = file.split("/").at(-2);
    console.log(JSON.stringify({ services: { proxy: {
      image: "example.test/lictory-proxy:" + version,
      environment: JSON.parse(readFileSync(root + "/environment.json", "utf8")),
    } } }));
  } else if (args.includes("up")) process.exit(1);
} else if (args[0] === "run") {
  if (process.env.FAIL_CADDY) {
    console.log(${JSON.stringify(sentinel)});
    console.error(${JSON.stringify(sentinel)});
    process.exit(1);
  }
  process.stdout.write(readFileSync(root + "/adapted.json", "utf8"));
}
`,
    { mode: 0o700 },
  );
  return {
    home,
    writeJson,
    run(command: string, extraEnv: Record<string, string> = {}) {
      const result = spawnSync(
        "bash",
        [join(bin, "deploy.sh"), "production", ...command.split(" ")],
        {
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            LICTORY_ROOT: root,
            TMPDIR: join(root, "tmp"),
            ...extraEnv,
          },
          input: release("3.0.0"),
          encoding: "utf8",
        },
      );
      const calls = readFileSync(join(root, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      assert.deepEqual(readdirSync(join(root, "tmp")), []);
      assert.equal(
        readFileSync(join(home, "release-history.log"), "utf8"),
        "yesterday activated 1.0.0\ntoday activated 2.0.0\n",
      );
      assert.ok(!result.stdout.includes(sentinel));
      assert.ok(!result.stderr.includes(sentinel));
      assert.ok(
        !readFileSync(join(home, "deploy.log"), "utf8").includes(sentinel),
      );
      return { ...result, calls };
    },
  };
}

for (const command of [
  "prepare",
  "release",
  "migrate 1.0.0",
  "activate 1.0.0",
  "rollback",
]) {
  void test(`${command}: rejected Caddy config leaves the running stack untouched`, (t) => {
    const f = fixture(t);
    const result = f.run(command, { FAIL_CADDY: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Caddy configuration is invalid/);
    assert.equal(result.calls.filter((call) => call[0] === "run").length, 1);
    assert.ok(
      !result.calls.some(
        (call) => call.includes("up") || call.includes("exec"),
      ),
    );
    assert.equal(
      readFileSync(join(f.home, "postgres/10-lictory-roles.sh"), "utf8"),
      "original",
    );
  });
}

void test("prepare uses the release image and exact resolved env with isolated validation", (t) => {
  const result = fixture(t).run("prepare");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "3.0.0\n");
  const run = result.calls.find((call) => call[0] === "run")!;
  for (const [option, value] of [
    ["--network", "none"],
    ["--log-driver", "none"],
    ["--pull", "never"],
    ["--entrypoint", "sh"],
  ])
    assert.equal(run[run.indexOf(option!) + 1], value);
  assert.ok(run.includes("example.test/lictory-proxy:3.0.0"));
  assert.ok(run.includes(`CADDY_TRUSTED_PROXIES=${peers}`));
  assert.ok(run.includes(`CADDY_GLOBAL_OPTIONS=${globalOptions}`));
  assert.ok(run.includes("--rm"));
  assert.ok(run.includes("/data:mode=1777"));
  assert.ok(run.includes("/config:mode=1777"));
  assert.ok(!run.includes("--volume") && !run.includes("--publish"));
  assert.match(
    run.at(-1)!,
    /caddy validate --config \/etc\/caddy\/Caddyfile --adapter caddyfile/,
  );
  assert.match(run.at(-1)!, /caddy adapt/);
  assert.ok(!result.calls.some((call) => call.includes("up")));
});

void test("standalone deployments can intentionally trust no proxies", (t) => {
  const f = fixture(t);
  f.writeJson("environment.json", { CADDY_TRUSTED_PROXIES: "" });
  f.writeJson("adapted.json", {
    apps: {
      http: {
        servers: {
          srv0: { ...serverDefaults, trusted_proxies: { source: "static" } },
        },
      },
    },
  });
  assert.equal(f.run("prepare").status, 0);
});

for (const override of [
  { trusted_proxies: { source: "static", ranges: ["private_ranges"] } },
  { trusted_proxies: { source: "static", ranges: [] } },
  { trusted_proxies: { source: "other" } },
  { trusted_proxies_strict: 0 },
  { protocols: ["h1", "h2", "h3"] },
  { read_header_timeout: undefined },
  { idle_timeout: undefined },
]) {
  void test(`prepare rejects overridden server safeguards: ${Object.keys(override)[0]}`, (t) => {
    const f = fixture(t);
    f.writeJson("adapted.json", {
      apps: {
        http: {
          servers: {
            srv0: serverDefaults,
            srv1: { ...serverDefaults, ...override },
          },
        },
      },
    });
    const result = f.run("prepare");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Caddy server safeguards were overridden/);
  });
}

void test("Compose diagnostics cannot leak env values", (t) => {
  const result = fixture(t).run("prepare", { FAIL_COMPOSE: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Compose configuration is invalid/);
  assert.ok(!result.calls.some((call) => call[0] === "run"));
});

void test("automatic recovery validates the previous release before rolling it", (t) => {
  const result = fixture(t).run("activate 1.0.0");
  assert.notEqual(result.status, 0);
  const relevant = result.calls.filter(
    (call) => call[0] === "run" || call.includes("up"),
  );
  assert.deepEqual(
    relevant.map((call) => call[0]),
    ["run", "compose", "run", "compose"],
  );
  assert.ok(relevant[0]!.includes("example.test/lictory-proxy:1.0.0"));
  // The current symlink selects the previously active release.
  assert.ok(relevant[2]!.includes("example.test/lictory-proxy:current"));
});
