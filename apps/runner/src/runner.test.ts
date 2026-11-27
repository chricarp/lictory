import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Assignment, RunnerEvent } from "@lictory/core/factory/protocol";
import {
  ProtocolError,
  describeNetworkError,
  type RunnerClient,
} from "@lictory/runner/client";
import {
  configSchema,
  containerImageProblem,
  pinnedImage,
  runnerLiveness,
  writeConfig,
  writeState,
  readState,
} from "@lictory/runner/config";
import {
  endLine,
  failureLog,
  machineReport,
  refuseIfRunning,
} from "@lictory/runner/daemon";
import { CliError, EXIT } from "@lictory/runner/output";
import { SessionRun } from "@lictory/runner/session";
import { EventStream } from "@lictory/runner/events";
import { confined, OutsideWorktree } from "@lictory/runner/harness/lictory";
import { defaultScript, fakeHarnesses } from "@lictory/runner/harness/fake";
import type {
  AgentHarness,
  HarnessContext,
} from "@lictory/runner/harness/types";
import { claudeReadiness } from "@lictory/runner/harness/claude-code";
import { codexReadiness } from "@lictory/runner/harness/codex";
import { hostExec, run } from "@lictory/runner/process";
import {
  launchdPlist,
  serviceLogCommand,
  systemdUnit,
} from "@lictory/runner/service";
import {
  deliverWorkspace,
  prepareWorkspace,
  removeWorkspace,
} from "@lictory/runner/workspace";

const scratch = await mkdtemp(join(tmpdir(), "lictory-runner-test-"));
after(() => rm(scratch, { recursive: true, force: true }));

// A server that stores each sequence once, like the real one.
function fakeServer(options: { failFirst?: boolean; lose?: boolean } = {}) {
  const stored: RunnerEvent[] = [];
  let calls = 0;
  const send = async (batch: RunnerEvent[]) => {
    calls++;
    if (options.lose) throw new ProtocolError(409, "lost", "lease_lost");
    const acked = stored.at(-1)?.seq ?? 0;
    const fresh = batch.filter((e) => e.seq > acked);
    if (fresh[0] && fresh[0].seq !== acked + 1)
      throw new ProtocolError(409, "gap", "sequence_gap", acked);
    stored.push(...fresh);
    // The response is lost after storing: the runner sends the batch again.
    if (options.failFirst && calls === 1)
      throw new ProtocolError(503, "unavailable");
    return { acked: stored.at(-1)?.seq ?? 0, status: "running" };
  };
  return { stored, send, calls: () => calls };
}

void test("event batches are resent safely and every sequence is stored once", async () => {
  const server = fakeServer({ failFirst: true });
  const stream = new EventStream(server.send);
  stream.push("message", { text: "one" });
  stream.push("command", { command: "ls", output: "a\nb" });
  await stream.close();
  assert.deepEqual(
    server.stored.map((e) => e.seq),
    [1, 2],
  );
  assert.ok(server.calls() >= 2);
});

void test("streamed text is coalesced into one message", async () => {
  const server = fakeServer();
  const stream = new EventStream(server.send);
  for (const delta of ["Refunds ", "now ", "work."])
    stream.pushText("message", delta);
  stream.push("tool_call", { callId: "1", name: "read_file" });
  stream.pushText("message", "Done.");
  await stream.close();
  assert.deepEqual(
    server.stored.map((e) => [e.type, e.data.text ?? e.data.name]),
    [
      ["message", "Refunds now work."],
      ["tool_call", "read_file"],
      ["message", "Done."],
    ],
  );
});

void test("a lost lease stops the stream and tells the session", async () => {
  const server = fakeServer({ lose: true });
  let lost = false;
  const stream = new EventStream(server.send, () => {
    lost = true;
  });
  stream.push("message", { text: "hello" });
  await stream.close();
  assert.equal(lost, true);
  assert.ok(stream.lost);
  // Nothing more is queued once the lease is gone.
  stream.push("message", { text: "after" });
  await stream.close();
  assert.equal(server.calls(), 1);
});

void test("built-in tools stay inside the worktree", async () => {
  const root = join(scratch, "confined");
  const outside = join(scratch, "outside");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await symlink(outside, join(root, "escape"));
  assert.equal(
    await confined(root, "src/new.ts"),
    join(await realRoot(root), "src", "new.ts"),
  );
  for (const path of ["../outside/x", "/etc/passwd", "escape/x", ".git/config"])
    await assert.rejects(confined(root, path), OutsideWorktree, path);
  // A link inside the worktree resolves to its target, and one to .git is
  // refused like .git itself.
  await symlink(join(root, "src"), join(root, "source"));
  await symlink(join(root, ".git"), join(root, "repo"));
  assert.equal(
    await confined(root, "source/new.ts"),
    join(await realRoot(root), "src", "new.ts"),
  );
  await assert.rejects(confined(root, "repo/config"), OutsideWorktree);
});

async function realRoot(path: string) {
  const { realpath } = await import("node:fs/promises");
  return realpath(path);
}

async function git(cwd: string, ...args: string[]) {
  const result = await run("git", args, { cwd });
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}

void test("a session's worktree comes from the cache, commits are pushed to its branch, and a retry continues from it", async () => {
  // A local "remote" with a main branch.
  const origin = join(scratch, "origin.git");
  const seed = join(scratch, "seed");
  await mkdir(seed, { recursive: true });
  await git(
    scratch,
    "init",
    "--quiet",
    "--bare",
    "--initial-branch",
    "main",
    origin,
  );
  await git(seed, "init", "--quiet", "--initial-branch", "main");
  await writeFile(join(seed, "README.md"), "# Payments\n");
  await git(seed, "add", ".");
  await git(
    seed,
    "-c",
    "user.name=Seed",
    "-c",
    "user.email=seed@example.test",
    "commit",
    "--quiet",
    "-m",
    "seed",
  );
  await git(seed, "push", "--quiet", origin, "main");

  const work = join(scratch, "work");
  const repository = {
    url: origin,
    baseBranch: null,
    branch: "lictory/pay-1-abc",
    auth: null,
  };
  const first = await prepareWorkspace(work, "session-1", repository);
  assert.equal(
    await readFile(join(first.path, "README.md"), "utf8"),
    "# Payments\n",
  );
  await writeFile(
    join(first.path, "refunds.ts"),
    "export const refunds = true;\n",
  );
  // Session files are never committed.
  await writeFile(join(first.scratch, "mcp.json"), "{}");
  const delivered = await deliverWorkspace(
    first,
    { name: "Forge", email: "forge@agents.lictory.invalid" },
    "Refunds\n\nRefs PAY-1",
  );
  assert.equal(delivered.branch, "lictory/pay-1-abc");
  assert.equal(delivered.commits, 1);
  assert.deepEqual(delivered.files, [{ path: "refunds.ts", kind: "add" }]);
  assert.match(
    await git(origin, "log", "--format=%an %s", "lictory/pay-1-abc"),
    /^Forge Refunds/,
  );
  assert.equal(
    await git(origin, "ls-tree", "--name-only", "lictory/pay-1-abc"),
    "README.md\nrefunds.ts",
  );
  await removeWorkspace(first);

  // The retry starts from the pushed branch, not from main.
  const second = await prepareWorkspace(work, "session-1b", repository);
  assert.equal(
    await readFile(join(second.path, "refunds.ts"), "utf8"),
    "export const refunds = true;\n",
  );
  // Nothing new: nothing is pushed.
  const nothing = await deliverWorkspace(
    second,
    { name: "Forge", email: "forge@agents.lictory.invalid" },
    "No-op",
  );
  assert.equal(nothing.branch, null);
  await removeWorkspace(second);
});

void test("the scripted harness walks its script with steering and approval", async () => {
  const worktree = join(scratch, "fake");
  await mkdir(worktree, { recursive: true });
  const events: [string, Record<string, unknown>][] = [];
  const messages = ["Use the v2 API"];
  const harness = fakeHarnesses(defaultScript).find(
    (h) => h.id === "claude-code",
  )!;
  const context: HarnessContext = {
    sessionId: "s",
    prompt: "Implement refunds",
    instructions: "",
    model: null,
    worktree,
    exec: hostExec(worktree),
    config: configSchema.parse({
      url: "https://lictory.example.test",
      runnerId: "r",
      organizationId: "o",
      name: "test",
      personal: false,
      credential: "lcr_x",
    }),
    lictory: {
      mcpUrl: "https://lictory.example.test/api/mcp",
      token: "lct_x",
      organizationId: "org-1",
    },
    scratch: { host: worktree, exec: worktree },
    emit: (type, data) => {
      events.push([type, data]);
      if (type === "approval_request")
        setTimeout(
          () => runHandle.answer(String(data.requestId), "approve", null),
          5,
        );
    },
    emitText: () => undefined,
    nextMessage: () => Promise.resolve(messages.shift() ?? null),
    languageModel: null,
    signal: new AbortController().signal,
    log: () => undefined,
  };
  const runHandle = harness.start(context);
  const result = await runHandle.done;
  assert.equal(result.outcome, "completed");
  const types = events.map(([type]) => type);
  assert.ok(types.includes("approval_request"));
  assert.ok(events.some(([, d]) => d.text === "Got it: Use the v2 API"));
  assert.ok(
    events.some(([, d]) => d.text === "Approved: Run the database migration."),
  );
  assert.equal(
    await readFile(join(worktree, "CHANGES.md"), "utf8"),
    "# Changes\n\n- Refunds over the API.\n",
  );
});

void test("service definitions run `start` with the runner's home", () => {
  const unit = systemdUnit({
    system: false,
    home: "/home/ada/.config/lictory-runner",
    user: "ada",
  });
  assert.match(unit, /ExecStart=.+ start$/m);
  assert.match(
    unit,
    /Environment=LICTORY_RUNNER_HOME=\/home\/ada\/.config\/lictory-runner/,
  );
  assert.match(unit, /WantedBy=default.target/);
  // Restarting cannot fix a revoked credential or a missing registration.
  assert.match(unit, /^Restart=always$/m);
  assert.match(
    unit,
    new RegExp(
      `^RestartPreventExitStatus=${EXIT.needsPerson} ${EXIT.usage}$`,
      "m",
    ),
  );
  assert.doesNotMatch(unit, /^User=/m);
  assert.match(
    systemdUnit({ system: true, home: "/srv/runner", user: "runner" }),
    /^User=runner$/m,
  );
  const plist = launchdPlist({
    home: "/Users/ada/runner",
    logs: "/Users/ada/runner/logs",
  });
  assert.match(plist, /<string>start<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
});

const config = configSchema.parse({
  url: "https://lictory.example.test",
  runnerId: "r",
  organizationId: "o",
  name: "build-01",
  personal: false,
  credential: "lcr_x",
});

const assignment: Assignment = {
  sessionId: "s-1",
  leaseToken: "lease-1",
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  attempt: 1,
  organizationId: "o",
  title: "Add a changelog entry",
  prompt: "Add a changelog entry",
  agent: {
    id: "a",
    name: "Forge",
    handle: "forge",
    harness: "claude-code",
    model: null,
    instructions: "",
    access: "write",
  },
  requestedBy: { id: "u", name: "Mei" },
  workItem: null,
  repository: null,
  lictory: { url: "", mcpUrl: "", token: "lct_x" },
  inputCursor: 0,
  modelProxy: false,
};

// A harness that works until the session stops it.
const untilStopped: AgentHarness = {
  id: "claude-code",
  detect: () => Promise.resolve("1"),
  start(context) {
    let stop = () => undefined as void;
    const done = new Promise<{ outcome: "failed"; error: string }>(
      (resolve) => {
        stop = () => resolve({ outcome: "failed", error: "stopped" });
        context.signal.addEventListener("abort", stop, { once: true });
      },
    );
    return { done, stop, interrupt: () => undefined, answer: () => undefined };
  },
};

// The server side of one session whose lease ends after the first input
// poll, as a person's cancel (or an expired lease) ends it.
function endingClient() {
  let polls = 0;
  const session = {
    workspace: () => Promise.resolve({ repository: null }),
    start: () => Promise.resolve({ status: "running" }),
    events: (_lease: string, batch: { seq: number }[]) =>
      Promise.resolve({ acked: batch.at(-1)?.seq ?? 0, status: "running" }),
    inputs: async () => {
      if (polls++ === 0) return { status: "running", inputs: [] };
      throw new ProtocolError(409, "lease gone", "lease_lost");
    },
    complete: () => Promise.resolve({ status: "completed" }),
    release: () => Promise.resolve({ status: "queued" }),
    model: () => Promise.reject(new Error("no model")),
  };
  return { session: () => session } as unknown as RunnerClient;
}

for (const [serverStatus, outcome] of [
  ["canceled", "canceled"],
  ["queued", "lost"],
  [null, "lost"],
] as const)
  void test(`a session whose lease ends with the session ${serverStatus ?? "unknown"} ends ${outcome}`, async () => {
    const logs: string[] = [];
    const run = new SessionRun(assignment, {
      client: endingClient(),
      config,
      harness: untilStopped,
      workDir: join(scratch, `ending-${outcome}-${serverStatus}`),
      log: (line) => logs.push(line),
      leaseStatus: () => Promise.resolve(serverStatus),
    });
    const end = await run.run();
    assert.equal(end.outcome, outcome);
    assert.ok(
      logs.some((l) =>
        outcome === "canceled"
          ? l.includes("canceled in Lictory")
          : l.includes("no longer holds the session"),
      ),
      logs.join("\n"),
    );
  });

void test("the log says how each session ended", () => {
  assert.equal(
    endLine(
      "s-1",
      { outcome: "completed", branch: "lictory/kst-2", repository: true },
      125_000,
    ),
    "Session s-1 completed after 2 min; pushed branch lictory/kst-2, which Lictory opens or updates a pull request for.",
  );
  assert.equal(
    endLine("s-1", { outcome: "completed", repository: false }, 3_000),
    "Session s-1 completed after 3 s (no repository linked: nothing pushed).",
  );
  assert.equal(
    endLine(
      "s-1",
      { outcome: "failed", error: "claude exited 1\ntrace", reported: true },
      4_000,
    ),
    "Session s-1 failed after 4 s: claude exited 1",
  );
  assert.match(
    endLine("s-1", { outcome: "canceled" }, 1_000),
    /canceled in Lictory/,
  );
  assert.match(endLine("s-1", { outcome: "returned" }, 1_000), /queue/);
});

void test("a second runner on one configuration is refused, and a stale state is not a running runner", async () => {
  const home = join(scratch, "liveness");
  const now = Date.now();
  const fresh = new Date(now).toISOString();
  // This test's process stands in for another running runner.
  const other = { pid: process.ppid, startedAt: fresh };
  await writeState(
    {
      ...other,
      updatedAt: fresh,
      lastHeartbeatAt: null,
      lastError: null,
      sessions: [],
    },
    home,
  );
  await assert.rejects(refuseIfRunning(home), (error: unknown) => {
    assert.ok(error instanceof CliError);
    assert.match(
      error.message,
      new RegExp(`already runs .*pid ${process.ppid}`),
    );
    return true;
  });
  const state = (await readState(home))!;
  assert.equal(runnerLiveness(state, { now, staleAfterMs: 45_000 }), "running");
  // Written long ago: a reused PID after a crash or reboot.
  assert.equal(
    runnerLiveness(state, { now: now + 60 * 60_000, staleAfterMs: 45_000 }),
    "unresponsive",
  );
  // Stopped cleanly, or its process is gone.
  assert.equal(
    runnerLiveness(
      { ...state, updatedAt: null },
      { now, staleAfterMs: 45_000 },
    ),
    "stopped",
  );
  assert.equal(
    runnerLiveness(
      { ...state, pid: 2 ** 22 + 7 },
      { now, staleAfterMs: 45_000 },
    ),
    "stopped",
  );
  await writeState({ ...state, updatedAt: null }, home);
  await refuseIfRunning(home);
});

void test("a repeating failure is logged once, reminded every five minutes, and its recovery logged", () => {
  const lines: string[] = [];
  let clock = Date.UTC(2026, 10, 26, 9, 0, 0);
  const failures = failureLog(
    (l) => lines.push(l),
    "Heartbeat",
    300_000,
    () => clock,
  );
  const down =
    "Could not connect to http://127.0.0.1:9: nothing accepted the connection.";
  failures.fail(down, " Next try in 2 s.");
  for (let i = 0; i < 20; i++) {
    clock += 10_000;
    failures.fail(down, " Next try in 4 s.");
  }
  clock += 200_000;
  failures.fail(down);
  failures.ok();
  failures.ok();
  assert.deepEqual(lines, [
    `Heartbeat failed: ${down} Next try in 2 s. The runner keeps retrying and says so every 5 min.`,
    "Heartbeat still failing: 22 attempts since 2026-11-26T09:00:00.000Z.",
    "Heartbeat works again after 22 failed attempts.",
  ]);
});

void test("unreachable servers are described by address and what to check", () => {
  assert.match(
    describeNetworkError(
      "http://127.0.0.1:9",
      "ConnectionRefused",
      new Error("Unable to connect. Is the computer able to access the url?"),
    ),
    /^Could not connect to http:\/\/127\.0\.0\.1:9: .*port/,
  );
  assert.match(
    describeNetworkError(
      "https://example.invalid",
      "ENOTFOUND",
      new Error("getaddrinfo ENOTFOUND example.invalid"),
    ),
    /^Could not find example\.invalid: the name does not resolve/,
  );
  assert.match(
    describeNetworkError(
      "https://lictory.example.test",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      new Error("self signed"),
    ),
    /NODE_EXTRA_CA_CERTS/,
  );
});

void test("container isolation needs an image the operator chose; Lictory names none", () => {
  const base = {
    url: "https://lictory.example.test",
    runnerId: "r",
    organizationId: "o",
    name: "box",
    personal: false,
    credential: "lcr_x",
  };
  const host = configSchema.parse(base);
  assert.equal(host.containerImage, undefined);
  assert.equal(containerImageProblem(host), null);
  const container = configSchema.parse({ ...base, isolation: "container" });
  assert.match(
    containerImageProblem(container) ?? "",
    /needs an image .* --container-image/,
  );
  const image = `registry.example.test/sandbox@sha256:${"a".repeat(64)}`;
  assert.equal(
    containerImageProblem({ ...container, containerImage: image }),
    null,
  );
  assert.ok(pinnedImage(image));
  assert.ok(!pinnedImage("registry.example.test/sandbox:latest"));
});

void test("the log narrates a session's waits, steering and answers", async () => {
  // Asks for an approval, then waits for a person's message.
  const asking: AgentHarness = {
    id: "claude-code",
    detect: () => Promise.resolve("1"),
    start(context) {
      const done = (async () => {
        context.emit("approval_request", {
          requestId: "req-1",
          title: "Run the database migration",
          tool: "Bash",
        });
        // A request naming no tool is a question, and the log says so.
        context.emit("approval_request", {
          requestId: "req-2",
          title: "Which release should the entry name?",
        });
        await context.nextMessage(60_000);
        return { outcome: "completed" as const };
      })();
      return {
        done,
        stop: () => undefined,
        interrupt: () => undefined,
        answer: () => undefined,
      };
    },
  };
  let polls = 0;
  const session = {
    workspace: () => Promise.resolve({ repository: null }),
    start: () => Promise.resolve({ status: "running" }),
    events: (_lease: string, batch: { seq: number }[]) =>
      Promise.resolve({ acked: batch.at(-1)?.seq ?? 0, status: "running" }),
    inputs: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (polls++ > 0) return { status: "running", inputs: [] };
      return {
        status: "running",
        inputs: [
          {
            seq: 1,
            kind: "approval_answer",
            data: { requestId: "req-1", decision: "approve" },
          },
          {
            seq: 2,
            kind: "approval_answer",
            data: { requestId: "req-2", decision: "answer", note: "2.1" },
          },
          { seq: 3, kind: "message", data: { text: "Use the v2 API" } },
        ],
      };
    },
    complete: () => Promise.resolve({ status: "completed" }),
    release: () => Promise.resolve({ status: "queued" }),
  };
  const logs: string[] = [];
  // Every change of state reaches the state file `status` reads at once.
  const states: string[] = [];
  // A line where a person must act links to the session's page.
  const page = "https://lictory.example.test/acme/factory/sessions/s-1";
  const run: SessionRun = new SessionRun(
    { ...assignment, sessionUrl: page },
    {
      client: { session: () => session } as unknown as RunnerClient,
      config,
      harness: asking,
      workDir: join(scratch, "narrated"),
      log: (line) => logs.push(line),
      onStateChange: () => states.push(run.state),
    },
  );
  assert.equal((await run.run()).outcome, "completed");
  assert.deepEqual(logs, [
    "Session s-1: no repository is linked; it works in an empty workspace.",
    `Session s-1 waits for a person to approve “Run the database migration”. Open it: ${page}`,
    `Session s-1 waits for a person's answer to “Which release should the entry name?”. Open it: ${page}`,
    `Session s-1 waits for a person's message in its thread. Open it: ${page}`,
    "Session s-1: a person approved “Run the database migration”.",
    "Session s-1: a person answered “Which release should the entry name?”.",
    "Session s-1: a steering message arrived from its thread.",
  ]);
  assert.equal(states[0], "running");
  assert.ok(states.includes("waiting"));
});

void test("the scripted harness's interrupt stops the step and waits for the next message", async () => {
  const worktree = join(scratch, "fake-interrupt");
  await mkdir(worktree, { recursive: true });
  const said: string[] = [];
  const waits: number[] = [];
  const harness = fakeHarnesses([
    { sleep: 60_000 },
    { say: "Back to work." },
    { waitForMessage: true },
  ]).find((h) => h.id === "claude-code")!;
  let interruptNow: () => void = () => undefined;
  const replies = ["Fix the timeout instead", null];
  const run = harness.start({
    sessionId: "s",
    prompt: "Investigate the flaky test",
    instructions: "",
    model: null,
    worktree,
    exec: hostExec(worktree),
    config: configSchema.parse({
      url: "https://lictory.example.test",
      runnerId: "r",
      organizationId: "o",
      name: "test",
      personal: false,
      credential: "lcr_x",
    }),
    lictory: {
      mcpUrl: "https://lictory.example.test/api/mcp",
      token: "lct_x",
      organizationId: "org-1",
    },
    scratch: { host: worktree, exec: worktree },
    emit: (type, data) => {
      if (type === "message") said.push(String(data.text));
    },
    emitText: () => undefined,
    nextMessage: (waitMs) => {
      waits.push(waitMs);
      // Interrupting while it already waits for a message changes nothing.
      interruptNow();
      return Promise.resolve(replies.shift() ?? null);
    },
    languageModel: null,
    signal: new AbortController().signal,
    log: () => undefined,
  });
  interruptNow = () => run.interrupt();
  // The long sleep is cut short by the interrupt.
  setTimeout(() => run.interrupt(), 5);
  const result = await run.done;
  assert.equal(result.outcome, "completed");
  assert.deepEqual(said, [
    "Stopped. Waiting for your next message.",
    "Got it: Fix the timeout instead",
    "Back to work.",
    "No message arrived.",
  ]);
  // Both waits are for a person, long enough to be shown as waiting.
  assert.ok(waits.every((ms) => ms > 60_000));
});

void test("status and doctor say what a person must do, with the exit code start uses", async () => {
  const cliPath = join(import.meta.dirname, "cli.ts");
  const cli = (home: string, command: string) =>
    spawnSync("bun", [join(import.meta.dirname, "cli.ts"), command], {
      env: { ...process.env, LICTORY_RUNNER_HOME: home },
      encoding: "utf8",
    });

  // Not registered: 2 for status and doctor alike.
  const empty = join(scratch, "unregistered");
  assert.equal(cli(empty, "status").status, EXIT.needsPerson);
  const unregistered = cli(empty, "doctor");
  assert.equal(unregistered.status, EXIT.needsPerson);
  assert.match(unregistered.stdout, /^✗ fail Not registered$/m);

  // Stopped after the server refused the credential: status says so instead
  // of suggesting start, which would be refused again.
  const home = join(scratch, "revoked");
  await writeConfig(
    configSchema.parse({
      url: "http://127.0.0.1:9",
      runnerId: "r-1",
      organizationId: "o-1",
      name: "build-01",
      personal: false,
      credential: "synthetic",
    }),
    home,
  );
  await writeState(
    {
      pid: 2 ** 22 + 7,
      startedAt: new Date().toISOString(),
      updatedAt: null,
      lastHeartbeatAt: null,
      lastError: "This runner credential is invalid or revoked.",
      revoked: true,
      sessions: [],
    },
    home,
  );
  const revoked = cli(home, "status");
  assert.equal(revoked.status, EXIT.needsPerson);
  assert.match(
    revoked.stdout,
    /Stopped: The server refused this runner's credential/,
  );
  assert.doesNotMatch(revoked.stdout, /Start it with/);

  // doctor agrees with status and start: a refused credential needs a
  // person (register again), 2, not a failed check's 1.
  const server = createServer((_request, response) => {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error: { message: "This runner credential is invalid or revoked." },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const refusedHome = join(scratch, "refused");
    await writeConfig(
      configSchema.parse({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        runnerId: "r-2",
        organizationId: "o-1",
        name: "build-02",
        personal: false,
        credential: "synthetic",
      }),
      refusedHome,
    );
    // Not spawnSync: this process must answer the runner's heartbeat.
    const doctor = spawn(process.execPath, [cliPath, "doctor"], {
      env: { ...process.env, LICTORY_RUNNER_HOME: refusedHome },
    });
    let stdout = "";
    doctor.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    const code = await new Promise<number | null>((resolve) =>
      doctor.on("close", resolve),
    );
    assert.equal(code, EXIT.needsPerson, stdout);
    assert.match(
      stdout,
      /^✗ fail The server refused this runner's credential/m,
    );
  } finally {
    server.close();
  }
});

void test("doctor's harness probes tell signed in from signed out, without naming the account", async () => {
  // Stand-ins for `claude auth status --json` and `codex login status`.
  const script = async (name: string, body: string) => {
    const path = join(scratch, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return path;
  };
  const signedIn = await claudeReadiness(
    await script(
      "claude-in",
      `echo '{"loggedIn": true, "authMethod": "api_key", "email": "someone@example.test"}'`,
    ),
  );
  assert.deepEqual(signedIn, { state: "ready", detail: "signed in (API key)" });
  const signedOut = await claudeReadiness(
    await script(
      "claude-out",
      `echo '{"loggedIn": false, "authMethod": "none"}'; exit 1`,
    ),
  );
  assert.equal(signedOut.state, "not-ready");
  assert.match(signedOut.fix, /claude auth login/);
  // An older Claude Code without the command: unknown, not a failure.
  const old = await claudeReadiness(
    await script("claude-old", `echo "error: unknown command 'auth'"; exit 1`),
  );
  assert.equal(old.state, "unknown");

  assert.deepEqual(
    await codexReadiness(
      await script("codex-in", "echo 'Logged in using ChatGPT'"),
    ),
    { state: "ready", detail: "signed in (using ChatGPT)" },
  );
  const codexOut = await codexReadiness(
    await script("codex-out", "echo 'Not logged in' >&2; exit 1"),
  );
  assert.equal(codexOut.state, "not-ready");
  assert.match(codexOut.fix, /codex login/);
});

void test("logs reads the installed service's log, and says when there is none", async () => {
  const user = join(scratch, "logs-home");
  const options = { follow: false, lines: 50 };
  assert.equal(await serviceLogCommand(options, "linux", "/h", user), null);
  const unit = join(user, ".config", "systemd", "user");
  await mkdir(unit, { recursive: true });
  await writeFile(join(unit, "lictory-runner.service"), "");
  assert.deepEqual(
    await serviceLogCommand({ follow: true, lines: 50 }, "linux", "/h", user),
    [
      "journalctl",
      "--user",
      "-u",
      "lictory-runner",
      "-n",
      "50",
      "--no-pager",
      "-f",
    ],
  );
  const agents = join(user, "Library", "LaunchAgents");
  await mkdir(agents, { recursive: true });
  await writeFile(join(agents, "com.lictory.runner.plist"), "");
  assert.deepEqual(
    await serviceLogCommand(options, "darwin", "/runner-home", user),
    ["tail", "-n", "50", "/runner-home/logs/runner.log"],
  );
  assert.equal(await serviceLogCommand(options, "win32", "/h", user), null);
});

void test("the runner reports what each harness may do without asking, from its configuration", () => {
  const detected = fakeHarnesses(defaultScript)
    .filter((h) => h.id === "claude-code" || h.id === "codex")
    .map((harness) => ({ id: harness.id, version: "1.0.0", harness }));
  const report = machineReport(
    configSchema.parse({
      ...config,
      claudePermissionMode: "bypassPermissions",
    }),
    detected,
  );
  assert.deepEqual(
    report.harnesses.map((h) => [h.id, h.permissions]),
    [
      ["claude-code", "bypassPermissions"],
      ["codex", "workspace-write"],
    ],
  );
});
