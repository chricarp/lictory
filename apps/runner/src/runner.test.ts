import assert from "node:assert/strict";
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
import type { RunnerEvent } from "@lictory/core/factory/protocol";
import { ProtocolError } from "@lictory/runner/client";
import {
  configSchema,
  containerImageProblem,
  pinnedImage,
} from "@lictory/runner/config";
import { EventStream } from "@lictory/runner/events";
import { confined, OutsideWorktree } from "@lictory/runner/harness/lictory";
import { defaultScript, fakeHarnesses } from "@lictory/runner/harness/fake";
import type { HarnessContext } from "@lictory/runner/harness/types";
import { hostExec, run } from "@lictory/runner/process";
import { launchdPlist, systemdUnit } from "@lictory/runner/service";
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
