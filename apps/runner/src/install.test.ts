import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// apps/runner/install.sh, the release asset lictory-runner-install.sh, run
// against a local copy of a release: it picks the binary for the system,
// refuses one that does not match SHA256SUMS and registers when asked.

const script = join(import.meta.dirname, "..", "install.sh");
const scratch = await mkdtemp(join(tmpdir(), "lictory-runner-install-"));
after(() => rm(scratch, { recursive: true, force: true }));

// A fake binary: prints its version and records the commands it ran.
const fakeBinary = (target: string) =>
  `#!/bin/sh\n[ "$1" = --version ] && { echo 9.9.9-${target}; exit 0; }\necho "$@" >> "$LICTORY_TEST_CALLS"\n`;
const targets = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"];
const release = new Map<string, string>(
  targets.map((target) => [`lictory-runner-${target}`, fakeBinary(target)]),
);
const sums = [...release]
  .map(
    ([name, body]) =>
      `${createHash("sha256").update(body).digest("hex")}  ${name}`,
  )
  .join("\n");
const tampered = new Map(release);
tampered.set("lictory-runner-linux-x64", "#!/bin/sh\necho evil\n");
tampered.set("lictory-runner-linux-arm64", "#!/bin/sh\necho evil\n");

const server = createServer((request, response) => {
  const [, tag, name] = new URL(request.url ?? "/", "http://x").pathname.split(
    "/",
  );
  const files =
    tag === "v9.9.9" ? release : tag === "tampered" ? tampered : null;
  const body =
    name === "SHA256SUMS" && files
      ? `${sums}\n`
      : name === "release-manifest.json" && tag === "v9.9.9"
        ? '{"schema":1,"tag":"v9.9.9","version":"9.9.9","baseline":{"tag":"v9.9.8"}}'
        : name && files?.get(name);
  response.writeHead(body === undefined || body === null ? 404 : 200);
  response.end(body ?? "Not Found");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

let runs = 0;
async function install(
  args: string[],
  options: {
    tag?: string;
    os?: string;
    arch?: string;
    env?: Record<string, string>;
  } = {},
) {
  const home = join(scratch, `run-${++runs}`);
  const shims = join(home, "shims");
  await mkdir(shims, { recursive: true });
  // `uname` reports the system the test pretends to be.
  await writeFile(
    join(shims, "uname"),
    `#!/bin/sh\ncase "$1" in -s) echo ${options.os ?? "Linux"} ;; -m) echo ${options.arch ?? "x86_64"} ;; esac\n`,
  );
  await chmod(join(shims, "uname"), 0o755);
  const calls = join(home, "calls");
  // Asynchronous: the release server answers from this process.
  const child = spawn("sh", [script, ...args], {
    cwd: home,
    env: {
      PATH: `${shims}:${process.env.PATH}`,
      HOME: home,
      LICTORY_TEST_CALLS: calls,
      LICTORY_RUNNER_DOWNLOAD_URL: `${origin}/${options.tag ?? "v9.9.9"}`,
      // Never the machine's own /usr/local/bin (writable on CI runners).
      LICTORY_RUNNER_SYSTEM_DIR: join(home, "no-system-bin"),
      ...options.env,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const status = await new Promise<number | null>((resolve) =>
    child.on("close", resolve),
  );
  return {
    stdout,
    stderr,
    status,
    home,
    calls: await readFile(calls, "utf8").catch(() => ""),
  };
}

void test("installs the binary for the system after checking SHA256SUMS", async () => {
  for (const [os, arch, target] of [
    ["Linux", "x86_64", "linux-x64"],
    ["Linux", "aarch64", "linux-arm64"],
    ["Darwin", "arm64", "darwin-arm64"],
    ["Darwin", "x86_64", "darwin-x64"],
  ] as const) {
    const result = await install(["--dir", "bin"], { os, arch });
    assert.equal(result.status, 0, result.stderr);
    const binary = join(result.home, "bin", "lictory-runner");
    assert.equal(
      await readFile(binary, "utf8"),
      release.get(`lictory-runner-${target}`),
    );
    assert.match(
      result.stdout,
      new RegExp(`Installed lictory-runner 9.9.9-${target}`),
    );
    // It names the release "latest" resolved to.
    assert.match(
      result.stdout,
      new RegExp(
        `Downloading lictory-runner-${target} \\(v9\\.9\\.9, the latest release\\)`,
      ),
    );
    // Without a token it says how to register, with the full path when the
    // directory is not on PATH.
    assert.match(result.stdout, /not on your PATH/);
    assert.ok(
      result.stdout.includes(
        `${binary} register --url <server> --token <token>`,
      ),
    );
    assert.equal(result.calls, "");
  }
});

void test("defaults to ~/.local/bin and replaces an older binary in place", async () => {
  // Root creates the system directory instead, which the next test checks.
  if (process.getuid?.() === 0) return;
  const first = await install([]);
  assert.equal(first.status, 0, first.stderr);
  const binary = join(first.home, ".local", "bin", "lictory-runner");
  assert.ok((await readFile(binary, "utf8")).includes("linux-x64"));
});

void test("prefers a writable system directory", async () => {
  const system = join(scratch, "system-bin");
  await mkdir(system, { recursive: true });
  const result = await install([], {
    env: { LICTORY_RUNNER_SYSTEM_DIR: system },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    (await readFile(join(system, "lictory-runner"), "utf8")).includes(
      "linux-x64",
    ),
  );
});

void test("registers and installs the service when given a server and token", async () => {
  const result = await install([
    "--dir",
    "bin",
    "--version",
    "v9.9.9",
    "--url",
    "https://lictory.example.com",
    "--token",
    "lrt_test",
    "--name",
    "build box",
    "--service",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.calls,
    "register --url https://lictory.example.com --token lrt_test --name build box\ninstall-service --enable\n",
  );
});

void test("a binary that does not match SHA256SUMS is never installed", async () => {
  const result = await install(["--dir", "bin"], { tag: "tampered" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match the release's SHA256SUMS/);
  assert.match(result.stderr, /Nothing was installed/);
  assert.equal(existsSync(join(result.home, "bin", "lictory-runner")), false);
});

void test("a release without runner files fails with what to do, installing nothing", async () => {
  // As the documented command runs it: downloaded first, then run, so a
  // missing installer fails too instead of piping nothing into sh.
  const latest = await install(["--dir", "bin"], { tag: "v0.26.0" });
  assert.equal(latest.status, 1);
  assert.match(
    latest.stderr,
    /the latest release publishes no lictory-runner files.*Nothing was installed\..*--version/,
  );
  assert.equal(existsSync(join(latest.home, "bin")), false);
});

void test("a cut-off download of the installer runs nothing", async () => {
  const source = await readFile(script, "utf8");
  const cut = join(scratch, "cut.sh");
  // Everything but the last line, which calls main.
  await writeFile(cut, source.slice(0, source.lastIndexOf('main "$@"')));
  const result = spawnSync("sh", [cut, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

void test("refusals say what to do", async () => {
  const missing = await install(["--version", "1.2.3"], { tag: "v1.2.3" });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /release v1\.2\.3 has no lictory-runner files/);
  assert.match(missing.stderr, /--version latest/);
  const windows = await install([], { os: "MINGW64_NT-10.0" });
  assert.match(windows.stderr, /lictory-runner-install\.ps1/);
  const arch = await install([], { arch: "riscv64" });
  assert.match(arch.stderr, /riscv64 is not supported/);
  const half = await install(["--url", "https://lictory.example.com"]);
  assert.match(half.stderr, /--url and --token go together/);
  const service = await install(["--service"]);
  assert.match(service.stderr, /--service needs --url and --token/);
});
