import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AgentEntity,
  SessionEntity,
  SessionEventRow,
} from "@lictory/core/factory/entities";
import {
  filesChangedLabel,
  sessionProgress,
} from "@lictory/platform/components/factory/progress";
import {
  agentActivity,
  overviewBlocks,
  waitsOnMe,
} from "@lictory/platform/components/factory/overview-blocks";

let sequence = 0;
const event = (type: string, data: unknown): SessionEventRow => ({
  sessionId: "s1",
  sequence: ++sequence,
  type,
  data,
  createdAt: sequence,
});

void test("the last step is what the agent did, not bookkeeping", () => {
  sequence = 0;
  const progress = sessionProgress([
    event("user_message", { text: "Add refunds" }),
    event("command", { command: "bun test refunds\n--watch", exitCode: 0 }),
    event("status", { message: "Still working" }),
    event("reasoning", { text: "Next I will…" }),
  ]);
  assert.deepEqual(progress.step, {
    kind: "command",
    text: "bun test refunds",
    exitCode: 0,
  });
});

void test("files changed are counted once each, with their lines", () => {
  sequence = 0;
  const progress = sessionProgress([
    event("file_change", {
      changes: [
        { path: "src/refunds.ts", kind: "add", additions: 40, deletions: 0 },
      ],
    }),
    event("file_change", {
      changes: [
        { path: "src/refunds.ts", kind: "modify", additions: 2, deletions: 1 },
        { path: "CHANGES.md", kind: "add", additions: 3 },
      ],
    }),
    event("message", { text: "\nThe endpoint is implemented.\nMore." }),
  ]);
  assert.equal(progress.files.length, 2);
  assert.equal(progress.additions, 45);
  assert.equal(progress.deletions, 1);
  assert.equal(progress.partial, false);
  assert.equal(filesChangedLabel(progress), "2 files changed");
  assert.deepEqual(progress.step, {
    kind: "message",
    text: "The endpoint is implemented.",
  });
});

void test("a window that misses the start says the count may be higher", () => {
  sequence = 10;
  const progress = sessionProgress([
    event("file_change", { changes: [{ path: "a.ts" }] }),
  ]);
  assert.equal(progress.partial, true);
  assert.equal(filesChangedLabel(progress), "1+ files changed");
  assert.deepEqual(progress.step, { kind: "files", text: "Changed a.ts" });
});

const session = (
  id: string,
  status: SessionEntity["status"],
  extra: Partial<SessionEntity> = {},
) =>
  ({
    id,
    status,
    agentId: "forge",
    requestedById: "ada",
    approvals: [],
    updatedAt: `2026-11-24T10:0${id.length}:00.000Z`,
    completedAt: null,
    ...extra,
  }) as unknown as SessionEntity;

void test("each session is in exactly one block of the overview", () => {
  const agents = new Map<string, Pick<AgentEntity, "ownerId">>([
    ["forge", { ownerId: "ada" }],
    ["scout", { ownerId: "ben" }],
  ]);
  const sessions = [
    session("a", "waiting", {
      approvals: [{ id: "q" } as SessionEntity["approvals"][number]],
    }),
    // Waiting on Ben, who started it with his own agent: not mine to answer.
    session("bb", "waiting", { agentId: "scout", requestedById: "ben" }),
    session("ccc", "running"),
    session("dddd", "queued"),
    session("eeeee", "completed", { completedAt: "2026-11-24T11:00:00Z" }),
    session("ffffff", "failed", { completedAt: "2026-11-24T12:00:00Z" }),
  ];
  const blocks = overviewBlocks(sessions, agents, "ada");
  assert.deepEqual(
    blocks.needsYou.map((s) => s.id),
    ["a"],
  );
  // At work before queued.
  assert.deepEqual(
    blocks.running.map((s) => s.id),
    ["ccc", "bb", "dddd"],
  );
  assert.deepEqual(
    blocks.recent.map((s) => s.id),
    ["ffffff", "eeeee"],
  );
  assert.equal(blocks.queued, 1);
  const all = [...blocks.needsYou, ...blocks.running, ...blocks.recent];
  assert.equal(new Set(all.map((s) => s.id)).size, sessions.length);
  // Ben sees his own waiting session as his.
  assert.deepEqual(
    overviewBlocks(sessions, agents, "ben").needsYou.map((s) => s.id),
    ["bb"],
  );
});

void test("the badge and Needs you count the same sessions, questions or not", () => {
  const agents = new Map<string, Pick<AgentEntity, "ownerId">>([
    ["forge", { ownerId: "ada" }],
    ["scout", { ownerId: "ben" }],
  ]);
  const sessions = [
    // A question for Ada.
    session("a", "waiting", {
      approvals: [{ id: "q" } as SessionEntity["approvals"][number]],
    }),
    // Waiting for Ada's next message: no question, still hers to answer.
    session("bb", "waiting"),
    // Ben's agent, started by Ada: she answers it too.
    session("ccc", "waiting", { agentId: "scout" }),
    session("dddd", "waiting", { agentId: "scout", requestedById: "ben" }),
    session("eeeee", "running"),
  ];
  for (const userId of ["ada", "ben", "cy"]) {
    const badge = sessions.filter((s) => waitsOnMe(s, agents, userId));
    assert.deepEqual(
      badge.map((s) => s.id).sort(),
      overviewBlocks(sessions, agents, userId)
        .needsYou.map((s) => s.id)
        .sort(),
    );
  }
  assert.deepEqual(
    sessions.filter((s) => waitsOnMe(s, agents, "ada")).map((s) => s.id),
    ["a", "bb", "ccc"],
  );
});

void test("an agent's activity is the session that needs a person first", () => {
  const sessions = [
    session("a", "running"),
    session("bb", "waiting"),
    session("ccc", "completed"),
    session("dddd", "queued", { agentId: "scout" }),
  ];
  const forge = agentActivity("forge", sessions);
  assert.equal(forge.current?.id, "bb");
  assert.equal(forge.active, 2);
  assert.equal(forge.lastActive, "2026-11-24T10:03:00.000Z");
  assert.equal(agentActivity("scout", sessions).current?.id, "dddd");
  const idle = agentActivity("sentry", sessions);
  assert.equal(idle.current, null);
  assert.equal(idle.lastActive, null);
});
