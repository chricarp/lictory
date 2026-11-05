import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

// The self-hosting entry points (deploy/get.sh and deploy/bin/lictory) on a
// stubbed host: GitHub, Docker and the privileged host commands are fakes
// that record their calls, so nothing here touches the machine running it.

const repository = new URL("../../../../", import.meta.url).pathname;
const deploy = join(repository, "deploy");
const registry = "ghcr.io/chricarp";
const api = "https://api.github.com/repos/chricarp/lictory";
const recipient = `age1${"q".repeat(58)}`;
const user = userInfo().username;

function releaseFile(version: string, channel = "stable") {
  return [
    `LICTORY_VERSION=${version}`,
    `LICTORY_GIT_SHA=${"a".repeat(40)}`,
    `LICTORY_CHANNEL=${channel}`,
    ...["API", "MARKETING", "PROXY", "MIGRATE", "OPS"].map(
      (key, i) =>
        `${key}_IMAGE=${registry}/lictory-${key.toLowerCase()}@sha256:${String(i + 1).repeat(64)}`,
    ),
    "",
  ].join("\n");
}
const sha256 = (text: string) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;

type Route = { status?: number; body: string };

// Other tests in this process set application variables; the scripts under
// test must see only the host's basics and what each test passes.
function hostEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(LICTORY_|PLATFORM_URL$|SITE_|APP_HOST$|DEPLOY_USER$)/.test(key),
    ),
  );
}
const dockerEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|HOME|USER|TMPDIR|DOCKER_[A-Z_]+)$/.test(key),
    ),
  );

function fixture(t: TestContext) {
  const base = mkdtempSync(join(tmpdir(), "lictory-self-host-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root");
  const fake = join(base, "fake-bin");
  const bundle = join(base, "bundle");
  const calls = join(base, "calls.jsonl");
  mkdirSync(fake);
  // The deployment bundle as the ops image ships it, with install.sh
  // replaced: it would create users and systemd units on this machine.
  cpSync(deploy, bundle, { recursive: true });
  cpSync(join(deploy, "deploy.sh"), join(bundle, "bin/deploy.sh"));
  const recorder = (path: string, name: string, body = "") =>
    writeFileSync(
      path,
      `#!/usr/bin/env bun
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const stdin = ${JSON.stringify(name)} === "deploy.sh" && ["release", "prepare"].includes(args[1]) ? readFileSync(0, "utf8") : "";
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ name: ${JSON.stringify(name)}, args, stdin,
  environments: process.env.LICTORY_ENVIRONMENTS, root: process.env.LICTORY_ROOT,
  databaseAdminUrl: process.env.DATABASE_ADMIN_URL }) + "\\n");
${body}
`,
      { mode: 0o755 },
    );
  // install.sh: the layout deploy.sh and the CLI expect, nothing else.
  // A shell script hands over to the recorder (the CLI runs it with bash).
  writeFileSync(
    join(bundle, "provision/install.sh"),
    `#!/bin/sh\nexec ${JSON.stringify(join(base, "install-stub"))} "$@"\n`,
  );
  recorder(
    join(base, "install-stub"),
    "install.sh",
    `const root = process.env.LICTORY_ROOT;
for (const env of process.env.LICTORY_ENVIRONMENTS.split(" ")) mkdirSync(root + "/" + env + "/releases", { recursive: true });
mkdirSync(root + "/bin", { recursive: true });
cpSync(${JSON.stringify(join(base, "deploy.sh"))}, root + "/bin/deploy.sh");`,
  );
  // deploy.sh: records the release it is given and activates it. Bun runs
  // files named *.sh as shell scripts, so a wrapper hands over again.
  writeFileSync(
    join(base, "deploy.sh"),
    `#!/bin/sh\nexec ${JSON.stringify(join(base, "deploy-stub"))} "$@"\n`,
    { mode: 0o755 },
  );
  recorder(
    join(base, "deploy-stub"),
    "deploy.sh",
    `const home = process.env.LICTORY_ROOT + "/" + args[0];
if (args[1] === "release") {
  const version = /^LICTORY_VERSION=(.*)$/m.exec(stdin)[1];
  mkdirSync(home + "/releases/" + version, { recursive: true });
  writeFileSync(home + "/releases/" + version + "/release.env", stdin);
  rmSync(home + "/current", { force: true });
  symlinkSync("releases/" + version, home + "/current");
  console.log(version);
}
if (args[1] === "status") console.log("{}");`,
  );
  const routes: Record<string, Route> = {};
  const writeRoutes = () =>
    writeFileSync(join(base, "routes.json"), JSON.stringify(routes));
  writeRoutes();
  recorder(
    join(fake, "curl"),
    "curl",
    `const url = args.find((arg) => /^https?:\\/\\//.test(arg));
const routes = JSON.parse(readFileSync(${JSON.stringify(join(base, "routes.json"))}, "utf8"));
const route = routes[url] ?? (url.endsWith("/readyz") ? { body: "" } : { status: 404, body: "{}" });
const status = route.status ?? 200;
const out = args.indexOf("-o");
if (out >= 0) writeFileSync(args[out + 1], route.body); else process.stdout.write(route.body);
if (args.includes("-w")) process.stdout.write(String(status));
const failOnError = args.some((arg) => /^-[A-Za-z]*f/.test(arg));
process.exit(failOnError && status >= 400 ? 22 : 0);`,
  );
  recorder(
    join(fake, "docker"),
    "docker",
    `if (args[0] === "version") console.log("29.0.0");
else if (args[0] === "compose" && args[1] === "version") console.log("2.30.0");
else if (args[0] === "info") console.log(${JSON.stringify(base)});
else if (args[0] === "pull" && process.env.FAKE_PULL_ERROR) { console.error(process.env.FAKE_PULL_ERROR); process.exit(1); }
else if (args[0] === "create") console.log("bundle-container");
else if (args[0] === "cp") cpSync(${JSON.stringify(bundle)}, args.at(-1), { recursive: true });`,
  );
  const script = (name: string, body: string) =>
    writeFileSync(join(fake, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  // A root-like host: Linux, uid 0, util-linux; runuser drops "-u <user> --".
  script("uname", 'case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac');
  script("id", '[ "$1" = -u ] && echo 0 || exec /usr/bin/id "$@"');
  script("flock", "exit 0");
  script("ss", "exit 0");
  script("systemctl", "exit 0");
  script("runuser", 'shift 3\nexec "$@"');

  const env = {
    ...hostEnvironment(),
    PATH: `${fake}:${process.env.PATH}`,
    LICTORY_ROOT: root,
    DEPLOY_USER: user,
    LICTORY_CLI_PATH: "none",
  };
  const recorded = () => {
    const lines = existsSync(calls)
      ? readFileSync(calls, "utf8").trim().split("\n")
      : [];
    rmSync(calls, { force: true });
    return lines.map(
      (line) =>
        JSON.parse(line) as {
          name: string;
          args: string[];
          stdin: string;
          environments?: string;
          databaseAdminUrl?: string;
        },
    );
  };
  const run = (
    command: string,
    args: string[],
    extra: Record<string, string> = {},
  ) => {
    const result = spawnSync(command, args, {
      env: { ...env, ...extra },
      input: "",
      encoding: "utf8",
    });
    return { ...result, calls: recorded() };
  };
  return {
    base,
    root,
    bundle,
    route(url: string, body: string, status?: number) {
      routes[url] = { body, status };
      writeRoutes();
    },
    getSh: (extra: Record<string, string> = {}) =>
      run("sh", [join(deploy, "get.sh")], extra),
    lictory: (args: string[], extra: Record<string, string> = {}) =>
      run("bash", [join(root, "bin/lictory"), ...args], extra),
  };
}

function githubRelease(
  f: ReturnType<typeof fixture>,
  version: string,
  options: { channel?: string; digest?: string; published?: string } = {},
) {
  const channel = options.channel ?? "stable";
  const file = releaseFile(version, channel);
  const asset = `https://github.com/chricarp/lictory/releases/download/v${version}/release.env`;
  f.route(asset, file);
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/chricarp/lictory/releases/tag/v${version}`,
    draft: false,
    prerelease: channel === "nightly",
    published_at: options.published ?? "2026-11-01T00:00:00Z",
    assets: [
      {
        name: "release.env",
        browser_download_url: asset,
        digest: options.digest ?? sha256(file),
      },
    ],
  };
}

// Tests that run several installs take seconds on a shared CI runner.
const slow = { timeout: 30_000 };

// The api container's administration CLI (apps/api/dist/admin.js) behind
// lictory-compose: records each call with its stdin and answers like the
// server. FAKE_ADMINS sets the administrator count; FAKE_ADMIN_ERROR makes
// every command except status fail with that message.
function stubAdministration(f: ReturnType<typeof fixture>) {
  writeFileSync(
    join(f.root, "bin/lictory-compose"),
    `#!/usr/bin/env bun
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const stdin = readFileSync(0, "utf8");
appendFileSync(${JSON.stringify(join(f.base, "calls.jsonl"))}, JSON.stringify({ name: "lictory-compose", args, stdin }) + "\\n");
const script = args.indexOf("apps/api/dist/admin.js");
if (script < 0) process.exit(0);
const [command, ...rest] = args.slice(script + 1);
const value = (flag) => rest[rest.indexOf(flag) + 1];
const user = (email) => ({ id: "user-1", name: value("--name") ?? "Grace Hopper", email });
const answer = (body, code = 0) => { console.log(JSON.stringify(body)); process.exit(code); };
if (command === "status")
  answer({ administrators: Number(process.env.FAKE_ADMINS ?? 0), users: 1, organizations: 1,
    signUpMode: "invite", organizationCreation: "administrators", allowedEmailDomains: [],
    passwordLogin: true, sso: null, email: true });
if (process.env.FAKE_ADMIN_ERROR)
  answer({ error: { code: "last_administrator", message: process.env.FAKE_ADMIN_ERROR } }, 1);
if (command === "setup")
  answer({ user: user(value("--email")), organization: { id: "org-1", name: value("--organization"), slug: value("--organization-handle") },
    url: "https://lictory.example.test/" + value("--organization-handle") });
if (command === "grant-admin" || command === "revoke-admin")
  answer({ user: user(rest[0]), instanceAdmin: command === "grant-admin" });
if (command === "set-password") answer({ user: user(rest[0]) });
answer({ error: { code: "usage", message: "unknown command " + command } }, 64);
`,
    { mode: 0o755 },
  );
}
const adminCalls = (calls: { name: string; args: string[]; stdin: string }[]) =>
  calls
    .filter((call) => call.name === "lictory-compose")
    .map((call) => ({
      args: call.args.slice(call.args.indexOf("apps/api/dist/admin.js") + 1),
      stdin: call.stdin,
      exec: call.args.slice(0, call.args.indexOf("apps/api/dist/admin.js")),
    }));

const acmeInstall = [
  "install",
  "--yes",
  "--ignore-requirements",
  "--host",
  "lictory.example.test",
  "--acme-email",
  "ops@example.test",
  "--backup",
  "none",
];

// The state get.sh leaves behind: tooling in <root>/bin and the verified
// bundle with its release.env in <root>/share/bundle.
function bootstrapped(t: TestContext, version = "1.2.3") {
  const f = fixture(t);
  f.route(`${api}/releases/latest`, JSON.stringify(githubRelease(f, version)));
  const result = f.getSh();
  assert.equal(result.status, 0, result.stderr);
  // deploy.sh activations install the release's tools, the CLI among them.
  cpSync(join(deploy, "bin/lictory"), join(f.root, "bin/lictory"));
  return f;
}

void test("get.sh installs the tooling of the newest stable release after verifying its digest", (t) => {
  const f = fixture(t);
  f.route(`${api}/releases/latest`, JSON.stringify(githubRelease(f, "1.2.3")));
  const result = f.getSh();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /release\.env matches GitHub's digest/);
  const pulls = result.calls.filter(
    (call) => call.name === "docker" && call.args[0] === "pull",
  );
  assert.deepEqual(
    pulls.map((call) => call.args.at(-1)),
    [`${registry}/lictory-ops@sha256:${"5".repeat(64)}`],
  );
  const install = result.calls.find((call) => call.name === "install.sh")!;
  assert.equal(install.environments, "production");
  assert.equal(
    readFileSync(join(f.root, "share/bundle/release.env"), "utf8"),
    releaseFile("1.2.3"),
  );
  assert.ok(
    existsSync(join(f.root, "share/bundle/env/self-hosted.env.example")),
  );
  assert.match(result.stdout, /sudo lictory install/);
});

void test("get.sh refuses a release.env that does not match GitHub's digest", (t) => {
  const f = fixture(t);
  f.route(
    `${api}/releases/latest`,
    JSON.stringify(githubRelease(f, "1.2.3", { digest: sha256("tampered") })),
  );
  const result = f.getSh();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match the digest GitHub publishes/);
  assert.ok(
    !result.calls.some(
      (call) => call.name === "docker" && call.args[0] === "pull",
    ),
  );
  assert.ok(!existsSync(f.root));
});

void test("get.sh picks the newest nightly and explains a refused image pull", (t) => {
  const f = fixture(t);
  const nightly = (version: string, published: string) =>
    githubRelease(f, version, { channel: "nightly", published });
  f.route(
    `${api}/releases?per_page=50`,
    JSON.stringify([
      nightly("1.3.0-nightly.20261101.1", "2026-11-01T00:00:00Z"),
      githubRelease(f, "1.2.3", { published: "2026-11-03T00:00:00Z" }),
      nightly("1.3.0-nightly.20261102.4", "2026-11-02T00:00:00Z"),
    ]),
  );
  const result = f.getSh({
    LICTORY_CHANNEL: "nightly",
    FAKE_PULL_ERROR: "Error response from daemon: denied: denied",
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /Lictory 1\.3\.0-nightly\.20261102\.4 \(nightly\)/,
  );
  assert.match(
    result.stderr,
    /may not be public yet[\s\S]*docker login ghcr\.io/,
  );
});

void test("the CLI refuses invalid input before touching the server", (t) => {
  const f = bootstrapped(t);
  for (const [args, message] of [
    [
      ["install", "--host", "https://lictory.example.test"],
      /--host: a lowercase host name/,
    ],
    [
      ["install", "--tls", "letsencrypt"],
      /--tls: one of acme, proxy, internal, http/,
    ],
    [["install", "--http-port", "70000"], /--http-port: a port number/],
    [["install", "--smtp-password", "it's"], /must not contain a single quote/],
    [["install", "--json"], /Unknown option for lictory install: --json/],
    [["install", "--host"], /--host needs a value/],
    [["status", "--env", "../production"], /--env: use lowercase letters/],
    [["upgrade", "latest"], /version: a release version/],
    [["logs", "database"], /Unknown service database/],
    [["deploy"], /Unknown command: deploy/],
    [
      ["install", "--signup-mode", "public"],
      /--signup-mode: one of invite, closed, open/,
    ],
    [
      ["install", "--organization-creation", "anyone"],
      /--organization-creation: administrators or everyone/,
    ],
    [
      ["install", "--allowed-email-domains", "example.test, not a domain"],
      /--allowed-email-domains: comma-separated lowercase email domains/,
    ],
    [
      ["install", "--organization-handle", "Acme Corp"],
      /--organization-handle: lowercase letters/,
    ],
    [["admin", "grant", "nobody"], /nobody is not an email address/],
    [["admin", "grant"], /Usage: lictory admin grant <email>/],
    [["admin", "promote"], /Unknown admin command: promote/],
  ] as const) {
    const result = f.lictory([...args]);
    assert.equal(result.status, 64, args.join(" "));
    assert.match(result.stderr, message);
    assert.deepEqual(result.calls, [], args.join(" "));
  }
  // Without an environment, everyday commands point to install.
  const status = f.lictory(["status"]);
  assert.equal(status.status, 1);
  assert.match(status.stderr, /Run: sudo lictory install/);
});

void test(
  "install converges: secrets survive re-runs and only answered settings change",
  slow,
  (t) => {
    const f = bootstrapped(t);
    const home = join(f.root, "production");
    const first = f.lictory(
      [
        "install",
        "--yes",
        "--ignore-requirements",
        "--host",
        "lictory.example.test",
        "--acme-email",
        "ops@example.test",
        "--email",
        "smtp",
        "--smtp-host",
        "smtp.example.test",
        "--smtp-user",
        "lictory",
        "--smtp-from",
        "Lictory <lictory@example.test>",
        "--backup-age-recipient",
        recipient,
      ],
      { LICTORY_SMTP_PASSWORD: "pa$$word #1" },
    );
    assert.equal(first.status, 0, first.stderr + first.stdout);
    const created = readFileSync(join(home, ".env"), "utf8");
    assert.equal(statSync(join(home, ".env")).mode & 0o777, 0o600);
    assert.match(created, /^BETTER_AUTH_SECRET=[0-9a-f]{64}$/m);
    assert.match(created, /^APP_HOST=lictory\.example\.test$/m);
    assert.match(created, /^SMTP_PASSWORD='pa\$\$word #1'$/m);
    assert.match(created, /^LICTORY_IMAGE_REGISTRY=ghcr\.io\/chricarp$/m);
    assert.match(created, /^LICTORY_RELEASE_CHANNEL=stable$/m);
    assert.match(
      created,
      new RegExp(`^BACKUP_AGE_RECIPIENTS=${recipient}$`, "m"),
    );
    assert.doesNotMatch(created, /^SITE_HOST=/m);
    // The release get.sh verified is deployed; GitHub is not asked again.
    const releases = first.calls.filter((call) => call.name === "deploy.sh");
    assert.deepEqual(releases[0]!.args, ["production", "release"]);
    assert.equal(releases[0]!.stdin, releaseFile("1.2.3"));
    assert.ok(
      !first.calls.some(
        (call) =>
          call.name === "curl" && call.args.some((a) => a.startsWith(api)),
      ),
    );
    assert.match(
      first.stdout,
      /Lictory is up: https:\/\/lictory\.example\.test/,
    );

    const secret = /^BETTER_AUTH_SECRET=.*$/m.exec(created)![0];
    const second = f.lictory([
      "install",
      "--yes",
      "--ignore-requirements",
      "--smtp-host",
      "mail.example.test",
    ]);
    assert.equal(second.status, 0, second.stderr + second.stdout);
    const changed = readFileSync(join(home, ".env"), "utf8");
    assert.ok(changed.includes(secret));
    assert.match(changed, /^SMTP_HOST=mail\.example\.test$/m);
    assert.match(changed, /^SMTP_PASSWORD='pa\$\$word #1'$/m);
    assert.equal(
      changed.replace(/^SMTP_HOST=.*$/m, ""),
      created.replace(/^SMTP_HOST=.*$/m, ""),
    );
    assert.match(second.stdout, /Changes to .*\.env: SMTP_HOST/);
    const backups = readdirSync(home).filter((name) =>
      name.startsWith(".env.backup-"),
    );
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(home, backups[0]!), "utf8"), created);
    // An active environment is re-activated with its release, not upgraded.
    assert.deepEqual(
      second.calls
        .filter((call) => call.name === "deploy.sh")
        .map((call) => call.args),
      [["production", "activate", "1.2.3"]],
    );

    const third = f.lictory(["install", "--yes", "--ignore-requirements"]);
    assert.equal(third.status, 0, third.stderr + third.stdout);
    assert.equal(readFileSync(join(home, ".env"), "utf8"), changed);
    assert.match(third.stdout, /Nothing changed/);
    assert.ok(!third.calls.some((call) => call.name === "deploy.sh"));
  },
);

void test(
  "upgrade follows the environment's channel, forward only, with verified files",
  slow,
  (t) => {
    const f = bootstrapped(t);
    const install = f.lictory([
      "install",
      "--yes",
      "--ignore-requirements",
      "--host",
      "lictory.example.test",
      "--acme-email",
      "ops@example.test",
      "--backup",
      "none",
    ]);
    assert.equal(install.status, 0, install.stderr + install.stdout);

    f.route(
      `${api}/releases/latest`,
      JSON.stringify(githubRelease(f, "1.3.0")),
    );
    const upgrade = f.lictory(["upgrade", "--yes"]);
    assert.equal(upgrade.status, 0, upgrade.stderr + upgrade.stdout);
    assert.match(upgrade.stdout, /1\.2\.3 -> 1\.3\.0 \(stable\)/);
    assert.match(upgrade.stdout, /releases\/tag\/v1\.3\.0/);
    const release = upgrade.calls.find((call) => call.name === "deploy.sh")!;
    assert.deepEqual(release.args, ["production", "release"]);
    assert.equal(release.stdin, releaseFile("1.3.0"));

    const again = f.lictory(["upgrade", "--yes"]);
    assert.match(again.stdout, /already runs 1\.3\.0/);

    f.route(
      `${api}/releases/tags/v1.2.3`,
      JSON.stringify(githubRelease(f, "1.2.3")),
    );
    const older = f.lictory(["upgrade", "1.2.3", "--yes"]);
    assert.equal(older.status, 1);
    assert.match(
      older.stderr,
      /older than the active 1\.3\.0[\s\S]*lictory rollback/,
    );

    const nightly = "1.4.0-nightly.20261103.1";
    f.route(
      `${api}/releases/tags/v${nightly}`,
      JSON.stringify(githubRelease(f, nightly, { channel: "nightly" })),
    );
    const wrongChannel = f.lictory(["upgrade", nightly, "--yes"]);
    assert.equal(wrongChannel.status, 1);
    assert.match(
      wrongChannel.stderr,
      /is a nightly release; environment production follows stable/,
    );

    f.route(
      `${api}/releases/tags/v1.4.0`,
      JSON.stringify(githubRelease(f, "1.4.0", { digest: sha256("other") })),
    );
    const tampered = f.lictory(["upgrade", "1.4.0", "--yes"]);
    assert.equal(tampered.status, 1);
    assert.match(tampered.stderr, /does not match the digest/);
    for (const result of [older, wrongChannel, tampered])
      assert.ok(!result.calls.some((call) => call.name === "deploy.sh"));
  },
);

void test("an installation with only an app host name renders without a website", (t) => {
  if (spawnSync("docker", ["compose", "version"]).status !== 0) {
    t.skip("Docker Compose is not available");
    return;
  }
  const base = mkdtempSync(join(tmpdir(), "lictory-compose-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const created = spawnSync(
    "bash",
    [join(deploy, "provision/new-environment.sh"), "production"],
    {
      env: {
        ...hostEnvironment(),
        LICTORY_ROOT: base,
        LICTORY_ENV_TEMPLATE: join(deploy, "env/self-hosted.env.example"),
      },
      encoding: "utf8",
    },
  );
  assert.equal(created.status, 0, created.stderr);
  const env = join(base, "production/.env");
  writeFileSync(join(base, "release.env"), releaseFile("1.2.3"));
  const render = (extra: string) => {
    writeFileSync(env, readFileSync(env, "utf8") + extra);
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--project-name",
        "lictory-render-test",
        "--file",
        join(deploy, "compose.production.yaml"),
        "--env-file",
        env,
        "--env-file",
        join(base, "release.env"),
        "config",
        "--format",
        "json",
      ],
      // Compose prefers shell variables over env files: only Docker's own.
      { encoding: "utf8", env: dockerEnvironment() },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as {
      services: Record<
        string,
        {
          environment: Record<string, string>;
          ports?: { host_ip?: string; published?: string; target: number }[];
        }
      >;
    };
  };
  const single = render(
    "APP_HOST=lictory.example.test\nACME_EMAIL=ops@example.test\n",
  );
  assert.equal(single.services.api!.environment.SITE_URL, "");
  assert.equal(
    single.services.api!.environment.PLATFORM_URL,
    "https://lictory.example.test",
  );
  assert.equal(single.services.proxy!.environment.PROXY_SCHEME, "https");

  // Plain HTTP on loopback keeps 443 off the public interface.
  const http = render(
    "PROXY_SCHEME=http\nPLATFORM_URL=http://localhost:8080\nHTTP_PORT=8080\nHTTP_BINDING=127.0.0.1:8080:80\nHTTPS_BINDING=127.0.0.1::443\n",
  );
  for (const port of http.services.proxy!.ports!)
    assert.equal(port.host_ip, "127.0.0.1");

  // lictory.com keeps its separate marketing site.
  const site = render("SITE_HOST=lictory.example.com\n");
  assert.equal(
    site.services.worker!.environment.SITE_URL,
    "https://lictory.example.com",
  );
});

void test(
  "install restricts access by default and records the chosen policy",
  slow,
  (t) => {
    const f = bootstrapped(t);
    stubAdministration(f);
    const env = join(f.root, "production/.env");
    const first = f.lictory(acmeInstall);
    assert.equal(first.status, 0, first.stderr + first.stdout);
    const created = readFileSync(env, "utf8");
    assert.match(created, /^LICTORY_SIGNUP_MODE=invite$/m);
    assert.match(created, /^LICTORY_ALLOWED_EMAIL_DOMAINS=$/m);
    assert.match(created, /^LICTORY_ORGANIZATION_CREATION=administrators$/m);
    // Without administrator details the install asks the server and points to
    // `lictory admin setup` instead of creating anyone.
    assert.deepEqual(
      adminCalls(first.calls).map((call) => call.args[0]),
      ["status"],
    );
    assert.deepEqual(adminCalls(first.calls)[0]!.exec, [
      "production",
      "exec",
      "-T",
      "api",
      "node",
    ]);
    assert.match(first.stdout, /sudo lictory admin setup/);
    assert.match(
      first.stdout,
      /people join when an administrator invites them/,
    );
    assert.doesNotMatch(first.stdout, /create the first account/i);

    const closed = f.lictory([
      ...acmeInstall,
      "--signup-mode",
      "closed",
      "--allowed-email-domains",
      "Example.test, corp.example.test",
      "--organization-creation",
      "everyone",
    ]);
    assert.equal(closed.status, 0, closed.stderr + closed.stdout);
    const changed = readFileSync(env, "utf8");
    assert.match(changed, /^LICTORY_SIGNUP_MODE=closed$/m);
    assert.match(
      changed,
      /^LICTORY_ALLOWED_EMAIL_DOMAINS=example\.test,corp\.example\.test$/m,
    );
    assert.match(changed, /^LICTORY_ORGANIZATION_CREATION=everyone$/m);
    assert.match(closed.stdout, /only instance administrators create accounts/);
  },
);

void test(
  "install creates the first administrator, the password only on stdin",
  slow,
  (t) => {
    const f = bootstrapped(t);
    stubAdministration(f);
    const password = "Correct-horse-battery-9";
    const install = f.lictory(
      [
        ...acmeInstall,
        "--admin-email",
        "ada@example.test",
        "--admin-name",
        "Ada Lovelace",
        "--organization",
        "Acme Corp",
      ],
      { LICTORY_ADMIN_PASSWORD: password },
    );
    assert.equal(install.status, 0, install.stderr + install.stdout);
    const calls = adminCalls(install.calls);
    assert.deepEqual(
      calls.map((call) => call.args),
      [
        ["status", "--json"],
        [
          "setup",
          "--organization",
          "Acme Corp",
          "--name",
          "Ada Lovelace",
          "--email",
          "ada@example.test",
          "--organization-handle",
          "acme-corp",
          "--password-stdin",
          "--json",
        ],
      ],
    );
    assert.equal(calls[1]!.stdin, `${password}\n`);
    for (const call of install.calls)
      assert.ok(!call.args.some((arg) => arg.includes(password)), call.name);
    assert.match(
      install.stdout,
      /ada@example\.test is the instance administrator/,
    );
    assert.match(
      install.stdout,
      /Sign in at https:\/\/lictory\.example\.test as ada@example\.test/,
    );
    assert.match(install.stdout, /https:\/\/lictory\.example\.test\/admin/);

    // Once an administrator exists, installs leave administration alone.
    const again = f.lictory(acmeInstall, { FAKE_ADMINS: "1" });
    assert.equal(again.status, 0, again.stderr + again.stdout);
    assert.deepEqual(
      adminCalls(again.calls).map((call) => call.args[0]),
      ["status"],
    );
    assert.match(again.stdout, /1 instance administrator\(s\) already exist/);

    // A password the server would refuse is caught before it is sent.
    const weak = f.lictory(
      [
        ...acmeInstall,
        "--admin-email",
        "ada@example.test",
        "--admin-name",
        "Ada",
        "--organization",
        "Acme",
      ],
      { LICTORY_ADMIN_PASSWORD: "short" },
    );
    assert.equal(weak.status, 0, weak.stderr + weak.stdout);
    assert.match(
      weak.stderr,
      /LICTORY_ADMIN_PASSWORD: use 10 to 64 characters/,
    );
    assert.ok(!adminCalls(weak.calls).some((call) => call.args[0] === "setup"));
  },
);

void test("lictory admin passes commands to the api container", (t) => {
  const f = bootstrapped(t);
  stubAdministration(f);
  mkdirSync(join(f.root, "production"), { recursive: true });
  writeFileSync(
    join(f.root, "production/.env"),
    "APP_HOST=lictory.example.test\n",
    { mode: 0o600 },
  );
  const grant = f.lictory(["admin", "grant", "Grace@Example.test"]);
  assert.equal(grant.status, 0, grant.stderr + grant.stdout);
  assert.deepEqual(adminCalls(grant.calls)[0]!.args, [
    "grant-admin",
    "grace@example.test",
    "--json",
  ]);
  assert.match(
    grant.stdout,
    /<grace@example\.test> is an instance administrator/,
  );

  // Server refusals reach the operator as they are.
  const revoke = f.lictory(["admin", "revoke", "grace@example.test", "--yes"], {
    FAKE_ADMIN_ERROR: "Grace Hopper is the last active instance administrator.",
  });
  assert.equal(revoke.status, 1);
  assert.match(revoke.stderr, /last active instance administrator/);

  // Without a terminal, a removal needs --yes.
  const unconfirmed = f.lictory(["admin", "revoke", "grace@example.test"]);
  assert.equal(unconfirmed.status, 1);
  assert.match(unconfirmed.stderr, /pass --yes/);
  assert.deepEqual(adminCalls(unconfirmed.calls), []);

  const reset = f.lictory(["admin", "set-password", "grace@example.test"], {
    LICTORY_USER_PASSWORD: "Another-long-password-7",
  });
  assert.equal(reset.status, 0, reset.stderr + reset.stdout);
  const call = adminCalls(reset.calls)[0]!;
  assert.deepEqual(call.args, [
    "set-password",
    "grace@example.test",
    "--password-stdin",
    "--json",
  ]);
  assert.equal(call.stdin, "Another-long-password-7\n");

  const status = f.lictory(["admin", "status"], { FAKE_ADMINS: "2" });
  assert.equal(status.status, 0, status.stderr + status.stdout);
  assert.match(status.stdout, /administrators: 2/);
});

void test(
  "install with an external database records its connection, takes no backups and uses the administrator URL once",
  slow,
  (t) => {
    const f = bootstrapped(t);
    stubAdministration(f);
    const env = join(f.root, "production/.env");
    const adminUrl =
      "postgresql://admin:synthetic-admin-secret@db.example.test:5432/postgres?sslmode=require";
    const external = [
      ...acmeInstall,
      "--database",
      "external",
      "--database-host",
      "db.example.test",
      "--database-sslmode",
      "require",
    ];
    const installed = f.lictory(external, {
      LICTORY_DATABASE_ADMIN_URL: adminUrl,
    });
    assert.equal(installed.status, 0, installed.stderr + installed.stdout);
    const written = readFileSync(env, "utf8");
    assert.match(written, /^LICTORY_DATABASE=external$/m);
    assert.match(written, /^DATABASE_HOST=db\.example\.test$/m);
    assert.match(written, /^DATABASE_PORT=5432$/m);
    assert.match(written, /^DATABASE_SSLMODE=require$/m);
    assert.match(written, /^BACKUP_TARGET=none$/m);
    assert.ok(!written.includes("synthetic-admin-secret"));
    assert.match(installed.stdout, /external: db\.example\.test:5432/);
    assert.match(installed.stdout, /your database provider's/);
    const deployed = installed.calls.find(
      (call) => call.name === "deploy.sh" && call.args[1] === "release",
    );
    assert.equal(deployed?.databaseAdminUrl, adminUrl);
    assert.ok(
      !installed.calls.some((call) =>
        call.args.join(" ").includes("synthetic-admin-secret"),
      ),
    );

    const backup = f.lictory(["backup"]);
    assert.notEqual(backup.status, 0);
    assert.match(backup.stderr, /external database: Lictory takes no backups/);
    const restore = f.lictory(["restore", "none", "latest", "--yes"]);
    assert.notEqual(restore.status, 0);
    assert.match(restore.stderr, /point-in-time recovery/);
    const logs = f.lictory(["logs", "postgres"]);
    assert.equal(logs.status, 64);

    // Moving data between databases is a migration, not a setting.
    const moved = f.lictory([...acmeInstall, "--database", "bundled"]);
    assert.notEqual(moved.status, 0);
    assert.match(moved.stderr, /migration of the data/);
    assert.match(readFileSync(env, "utf8"), /^LICTORY_DATABASE=external$/m);
  },
);

void test("the external database override removes the bundled postgres and encrypts every connection", (t) => {
  if (spawnSync("docker", ["compose", "version"]).status !== 0) {
    t.skip("Docker Compose is not available");
    return;
  }
  const base = mkdtempSync(join(tmpdir(), "lictory-compose-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const created = spawnSync(
    "bash",
    [join(deploy, "provision/new-environment.sh"), "production"],
    {
      env: {
        ...hostEnvironment(),
        LICTORY_ROOT: base,
        LICTORY_ENV_TEMPLATE: join(deploy, "env/self-hosted.env.example"),
      },
      encoding: "utf8",
    },
  );
  assert.equal(created.status, 0, created.stderr);
  const env = join(base, "production/.env");
  writeFileSync(join(base, "release.env"), releaseFile("1.2.3"));
  writeFileSync(
    env,
    readFileSync(env, "utf8") +
      "APP_HOST=lictory.example.test\nACME_EMAIL=ops@example.test\n",
  );
  const render = (extra: string, profiles: string[] = []) => {
    writeFileSync(join(base, "extra.env"), extra);
    return spawnSync(
      "docker",
      [
        "compose",
        "--project-name",
        "lictory-render-test",
        ...profiles.flatMap((profile) => ["--profile", profile]),
        "--file",
        join(deploy, "compose.production.yaml"),
        "--file",
        join(deploy, "compose.external-database.yaml"),
        "--env-file",
        env,
        "--env-file",
        join(base, "release.env"),
        "--env-file",
        join(base, "extra.env"),
        "config",
        "--format",
        "json",
      ],
      { encoding: "utf8", env: dockerEnvironment() },
    );
  };
  // Without a host the override refuses to render.
  const missing = render("LICTORY_DATABASE=external\n");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /DATABASE_HOST/);

  const result = render(
    "LICTORY_DATABASE=external\nDATABASE_HOST=db.example.test\nDATABASE_CA_FILE=/srv/lictory/production/database-ca.pem\n",
    ["tools", "ops"],
  );
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout) as {
    services: Record<
      string,
      {
        environment: Record<string, string>;
        networks: Record<string, unknown>;
        depends_on?: Record<string, unknown>;
        volumes?: { source: string; target: string }[];
      }
    >;
  };
  assert.ok(!("postgres" in config.services));
  for (const name of ["migrate", "zero-cache", "api", "worker", "database"]) {
    const service = config.services[name]!;
    assert.ok("egress" in service.networks, name);
    assert.ok(!("postgres" in (service.depends_on ?? {})), name);
    assert.equal(
      service.environment.NODE_EXTRA_CA_CERTS,
      "/run/lictory/database-ca.pem",
      name,
    );
    assert.ok(
      service.volumes?.some(
        (volume) =>
          volume.source === "/srv/lictory/production/database-ca.pem" &&
          volume.target === "/run/lictory/database-ca.pem",
      ),
      name,
    );
  }
  const urls = [
    config.services.migrate!.environment.DATABASE_MIGRATION_URL!,
    config.services["zero-cache"]!.environment.ZERO_UPSTREAM_DB!,
    config.services["zero-cache"]!.environment.ZERO_CVR_DB!,
    config.services.api!.environment.DATABASE_URL!,
    config.services.worker!.environment.DATABASE_URL!,
  ];
  for (const url of urls) {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "db.example.test");
    assert.equal(parsed.searchParams.get("sslmode"), "verify-full");
  }
  assert.equal(
    config.services.migrate!.environment.DATABASE_MIGRATION_TRANSPORT,
    "tls",
  );
  assert.equal(
    config.services.migrate!.environment.DATABASE_MIGRATION_EXPECTED_HOST,
    "db.example.test",
  );
  assert.equal(config.services.ops!.environment.PGHOST, "db.example.test");
  assert.equal(config.services.ops!.environment.LICTORY_DATABASE, "external");
});
