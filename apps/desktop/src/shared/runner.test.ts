import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  backoffDelay,
  createRunnerSupervisor,
  type Clock,
  type SpawnRunner,
} from "./runner";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  signals: string[] = [];
  constructor(readonly pid: number) {
    super();
  }
  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.signals.push(signal);
    return true;
  }
}

function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout(run, ms) {
      const id = next++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id as number);
    },
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at))
        if (timer.at <= now) {
          timers.delete(id);
          timer.run();
        }
    },
    pending: () => timers.size,
  };
}

function harness(options: { stableAfterMs?: number } = {}) {
  const time = fakeClock();
  const children: FakeChild[] = [];
  const spawn: SpawnRunner = () => {
    const child = new FakeChild(100 + children.length);
    children.push(child);
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };
  const supervisor = createRunnerSupervisor({
    command: "/opt/lictory/runner/lictory-runner",
    args: ["start"],
    env: {},
    spawn,
    clock: time.clock,
    initialDelayMs: 1000,
    maxDelayMs: 8000,
    stableAfterMs: options.stableAfterMs ?? 60_000,
    stopGraceMs: 5000,
    maxLogLines: 5,
  });
  return { supervisor, children, time };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

void test("backoff doubles up to its ceiling", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((n) => backoffDelay(n, 1000, 8000)),
    [1000, 2000, 4000, 8000, 8000, 8000],
  );
});

void test("a crashing runner restarts with growing delays", async () => {
  const { supervisor, children, time } = harness();
  supervisor.start();
  await tick();
  assert.equal(supervisor.snapshot().status, "running");
  assert.equal(supervisor.snapshot().pid, 100);

  children[0]?.emit("exit", 1, null);
  assert.equal(supervisor.snapshot().status, "backoff");
  assert.equal(supervisor.snapshot().nextRestartAt, 1000);
  time.advance(999);
  assert.equal(children.length, 1);
  time.advance(1);
  assert.equal(children.length, 2);
  await tick();

  children[1]?.emit("exit", null, "SIGSEGV");
  assert.equal(supervisor.snapshot().nextRestartAt, 1000 + 2000);
  assert.equal(supervisor.snapshot().restarts, 2);
  assert.deepEqual(supervisor.snapshot().lastExit, {
    code: null,
    signal: "SIGSEGV",
  });
});

void test("a run that stayed up resets the backoff", async () => {
  const { supervisor, children, time } = harness({ stableAfterMs: 10_000 });
  supervisor.start();
  await tick();
  children[0]?.emit("exit", 1, null);
  time.advance(1000);
  await tick();
  children[1]?.emit("exit", 1, null);
  const second = supervisor.snapshot().nextRestartAt;
  assert.equal(second, 1000 + 2000);
  time.advance(2000);
  await tick();
  time.advance(10_000);
  children[2]?.emit("exit", 1, null);
  // Back to the first delay.
  assert.equal(supervisor.snapshot().nextRestartAt, 13_000 + 1000);
});

void test("a configuration error is not retried", async () => {
  const { supervisor, children, time } = harness();
  supervisor.start();
  await tick();
  children[0]?.emit("exit", 78, null);
  assert.equal(supervisor.snapshot().status, "failed");
  assert.match(supervisor.snapshot().message ?? "", /will not restart/);
  time.advance(60_000);
  assert.equal(children.length, 1);
  // Starting again by hand works.
  supervisor.start();
  assert.equal(children.length, 2);
});

void test("a missing binary fails with its reason", async () => {
  const { supervisor, children } = harness();
  supervisor.start();
  children[0]?.emit("error", new Error("spawn lictory-runner ENOENT"));
  assert.equal(supervisor.snapshot().status, "failed");
  assert.match(supervisor.snapshot().message ?? "", /ENOENT/);
});

void test("stopping terminates, then kills a runner that hangs", async () => {
  const { supervisor, children, time } = harness();
  supervisor.start();
  await tick();
  const stopped = supervisor.stop();
  assert.equal(supervisor.snapshot().status, "stopping");
  assert.deepEqual(children[0]?.signals, ["SIGTERM"]);
  time.advance(5000);
  assert.deepEqual(children[0]?.signals, ["SIGTERM", "SIGKILL"]);
  children[0]?.emit("exit", null, "SIGKILL");
  await stopped;
  assert.equal(supervisor.snapshot().status, "stopped");
  // A stopped runner is not restarted.
  time.advance(60_000);
  assert.equal(children.length, 1);
});

void test("stopping during a backoff cancels the restart", async () => {
  const { supervisor, children, time } = harness();
  supervisor.start();
  await tick();
  children[0]?.emit("exit", 1, null);
  await supervisor.stop();
  assert.equal(supervisor.snapshot().status, "stopped");
  time.advance(60_000);
  assert.equal(children.length, 1);
  assert.equal(time.pending(), 0);
});

void test("output is captured by line, without colours, within a limit", async () => {
  const { supervisor, children } = harness();
  supervisor.start();
  await tick();
  const child = children[0];
  child?.stdout.emit("data", Buffer.from("conn"));
  child?.stdout.emit(
    "data",
    Buffer.from("ected to lictory.example.com\n\u001b[32mready\u001b[0m\n"),
  );
  child?.stderr.emit("data", "warn: slow heartbeat\n");
  const texts = supervisor.logs().map((l) => `${l.stream}:${l.text}`);
  assert.deepEqual(texts.slice(-3), [
    "stdout:connected to lictory.example.com",
    "stdout:ready",
    "stderr:warn: slow heartbeat",
  ]);
  for (let i = 0; i < 10; i++) child?.stdout.emit("data", `line ${i}\n`);
  assert.equal(supervisor.logs().length, 5);
  assert.equal(supervisor.logs().at(-1)?.text, "line 9");
});
