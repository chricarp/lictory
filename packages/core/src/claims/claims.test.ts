import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import {
  directory,
  executeMutation,
  type Actor,
} from "@lictory/core/domain/service";
import { seedOrganization } from "@lictory/core/domain/organization";
import { projectionDrift } from "@lictory/core/domain/projection-reader.test-helper";
import {
  configureClaimPorts,
  resetClaimPorts,
  type CodeEvidence,
  type FactoryAgent,
  type MergeRequest,
  type SessionLaunch,
  type SessionResumeEvent,
} from "@lictory/core/claims/ports";
import {
  askQuestion,
  claimItem,
  followDefinitionOfDone,
  listClaimable,
  overrideDoneCheck,
  releaseClaim,
  renewClaim,
  reportProgress,
  retryDispatch,
  setAutonomyPolicy,
  setDefinitionOfDone,
  signOffDoneCheck,
} from "@lictory/core/claims/service";
import { runDispatcher } from "@lictory/core/claims/dispatcher";
import { WORK_CHANNEL } from "@lictory/core/jobs/signal";
import { defaultAutonomyPolicy } from "@lictory/core/claims/contracts";
import { invoke } from "@lictory/core/capabilities/registry";
import { noEffects } from "@lictory/core/capabilities/core";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_claims_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 8, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;
before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});
afterEach(() => resetClaimPorts());

async function fixture() {
  const organizationId = crypto.randomUUID();
  const ada = crypto.randomUUID();
  const bo = crypto.randomUUID();
  await db.insert(s.user).values([
    { id: ada, name: "Ada", email: `${ada}@example.test` },
    { id: bo, name: "Bo", email: `${bo}@example.test` },
  ]);
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Factory",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values([
    {
      id: crypto.randomUUID(),
      organizationId,
      userId: ada,
      role: "owner",
      createdAt: new Date(),
    },
    {
      id: crypto.randomUUID(),
      organizationId,
      userId: bo,
      role: "member",
      createdAt: new Date(),
    },
  ]);
  await seedOrganization(db, organizationId);
  const run = (command: Command, actor: Actor | string = ada) =>
    executeMutation(db, typeof actor === "string" ? { userId: actor } : actor, {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command,
    });
  const projectId = crypto.randomUUID();
  await run({ type: "createProject", projectId, name: "Payments", key: "PAY" });
  const seeded = await directory(db, ada, organizationId);
  const roles = Object.fromEntries(
    seeded.disciplines
      .filter((d) => d.projectId === projectId)
      .map((d) => [d.name, d.id]),
  ) as { Product: string; Engineering: string; QA: string };
  // Bo reviews (Engineering, QA) but does not change properties.
  for (const disciplineId of [roles.Engineering, roles.QA])
    await run({
      type: "updateDiscipline",
      projectId,
      disciplineId,
      capabilities: {
        editSpecifications: false,
        changeProperties: false,
        requestReviews: true,
        review: true,
        publishDelivery: false,
      },
    });
  for (const disciplineId of [roles.Engineering, roles.QA])
    await run({
      type: "setDisciplineMember",
      projectId,
      disciplineId,
      userId: bo,
      member: true,
    });
  const types = Object.fromEntries(
    seeded.types.map((t) => [t.name, t.id]),
  ) as Record<"Epic" | "Story" | "Task" | "Bug" | "Subtask", string>;
  const statuses = Object.fromEntries(
    seeded.statuses
      .filter((x) => x.projectId === projectId)
      .map((x) => [x.name, x.id]),
  ) as Record<
    "Backlog" | "Todo" | "In Progress" | "Code review" | "Done" | "Canceled",
    string
  >;
  const latest = async (workItemId: string) =>
    (
      await db
        .select()
        .from(s.specificationRevision)
        .where(eq(s.specificationRevision.workItemId, workItemId))
        .orderBy(desc(s.specificationRevision.number))
        .limit(1)
    )[0]!;
  const item = async (workItemId: string) =>
    (
      await db.select().from(s.workItem).where(eq(s.workItem.id, workItemId))
    )[0]!;
  const create = async (
    typeId: string,
    extra: Partial<Extract<Command, { type: "createWorkItem" }>> = {},
  ) => {
    const workItemId = crypto.randomUUID();
    await run({
      type: "createWorkItem",
      projectId,
      workItemId,
      typeId,
      parentId: null,
      title: "Item",
      description:
        "## Behavior\n\nRefunds over the API reuse the original transaction ID.\n\n## Acceptance criteria\n\n- A retry never charges twice.",
      ...extra,
    });
    return workItemId;
  };
  // Ready: Bo approves the required Engineering review.
  const makeReady = async (workItemId: string) => {
    const revision = await latest(workItemId);
    const reviewId = crypto.randomUUID();
    await run({
      type: "requestReview",
      workItemId,
      baseRevisionId: revision.id,
      reviewId,
      disciplineId: roles.Engineering,
      userId: bo,
      required: true,
    });
    await run(
      {
        type: "decideReview",
        workItemId,
        baseRevisionId: revision.id,
        reviewId,
        decision: "approve",
      },
      bo,
    );
    assert.equal((await item(workItemId)).refinementState, "ready");
  };
  const accept = async (workItemId: string) =>
    run({
      type: "acceptDeliveryScope",
      workItemId,
      baseRevisionId: (await latest(workItemId)).id,
    });
  // A specification agreed for delivery: ready, with its scope accepted.
  const agreed = async () => {
    const id = await create(types.Story);
    await makeReady(id);
    await accept(id);
    return id;
  };
  const agent = (name = "Forge", userId = ada): Actor => ({
    userId,
    surface: "mcp",
    agentId: `token-${name}`,
    agentName: name,
    client: "test",
  });
  const claimable = async () =>
    (
      await listClaimable(db, ada, {
        organizationId,
        projectId,
        all: true,
      })
    ).items;
  const claimRow = async (claimId: string) =>
    (
      await db
        .select()
        .from(s.workItemClaim)
        .where(eq(s.workItemClaim.id, claimId))
    )[0]!;
  const activity = async (workItemId: string) =>
    (
      await db
        .select()
        .from(s.activity)
        .where(eq(s.activity.workItemId, workItemId))
    ).map((a) => a.action);
  const drift = () => projectionDrift(db, organizationId);
  return {
    organizationId,
    projectId,
    ada,
    bo,
    roles,
    types,
    statuses,
    run,
    create,
    makeReady,
    accept,
    agreed,
    latest,
    item,
    agent,
    claimable,
    claimRow,
    activity,
    drift,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

const stageOf = async (f: Fixture, id: string) =>
  (await f.claimable()).find((i) => i.workItemId === id);

const codes = async (f: Fixture, id: string) =>
  (await stageOf(f, id))?.reasons.map((r) => r.code) ?? [];

void test("claimability: agreed scope, blockers and coverage of plain children", async () => {
  const f = await fixture();
  const spec = await f.create(f.types.Story);
  assert.deepEqual(await codes(f, spec), ["scope_not_accepted"]);
  assert.equal((await stageOf(f, spec))?.stage, "needs_agreement");
  await f.makeReady(spec);
  assert.deepEqual(await codes(f, spec), ["scope_not_accepted"]);
  await f.accept(spec);
  assert.equal((await stageOf(f, spec))?.stage, "claimable");
  // Accepting from the backlog selects it into Todo.
  assert.equal((await f.item(spec)).statusId, f.statuses.Todo);

  // A plain child is covered by its parent's accepted scope.
  const epic = await f.create(f.types.Epic);
  const task = await f.create(f.types.Task, { parentId: epic });
  assert.deepEqual(await codes(f, task), ["parent_scope_not_accepted"]);
  await f.makeReady(epic);
  await f.accept(epic);
  assert.equal((await stageOf(f, task))?.stage, "claimable");

  // Independent plain work needs a person to select it.
  const chore = await f.create(f.types.Task);
  assert.deepEqual(await codes(f, chore), ["not_selected"]);
  await f.run({
    type: "updateWorkItem",
    workItemId: chore,
    statusId: f.statuses.Todo,
  });
  assert.equal((await stageOf(f, chore))?.stage, "claimable");

  // Every blocking item must be done first.
  await f.run({
    type: "addRelation",
    workItemId: chore,
    relationId: crypto.randomUUID(),
    toId: spec,
    kind: "blocks",
  });
  const blocked = await stageOf(f, spec);
  assert.equal(blocked?.stage, "blocked");
  assert.deepEqual(
    blocked?.reasons.map((r) => r.code),
    ["blocked_by"],
  );
  assert.match(blocked?.reasons[0]?.message ?? "", /PAY-\d+ \(Todo\)/);
  await f.run({
    type: "updateWorkItem",
    workItemId: chore,
    statusId: f.statuses.Done,
  });
  assert.equal((await stageOf(f, spec))?.stage, "claimable");

  // Started work is outside the queue.
  await f.run({
    type: "updateWorkItem",
    workItemId: task,
    statusId: f.statuses["In Progress"],
  });
  assert.equal(await stageOf(f, task), undefined);
  assert.deepEqual(await f.drift(), []);
});

void test("claimability: readiness lost on the agreed revision follows the policy", async () => {
  const f = await fixture();
  const spec = await f.agreed();
  const revision = await f.latest(spec);
  // A blocking discussion on the agreed revision itself.
  const threadId = crypto.randomUUID();
  await f.run({
    type: "createThread",
    workItemId: spec,
    baseRevisionId: revision.id,
    threadId,
    messageId: crypto.randomUUID(),
    body: "Which currency applies?",
    blocking: true,
    section: "",
  });
  assert.equal((await f.item(spec)).refinementState, "in_review");
  assert.deepEqual(await codes(f, spec), ["not_ready"]);
  // With readiness off, readiness is informative and agents may start.
  await f.run({
    type: "updateProject",
    projectId: f.projectId,
    readinessPolicy: "off",
  });
  assert.equal((await stageOf(f, spec))?.stage, "claimable");
  assert.deepEqual(await f.drift(), []);
});

void test("claiming starts the item for the agent; people and external projects are refused", async () => {
  const f = await fixture();
  const spec = await f.agreed();
  await assert.rejects(
    claimItem(
      db,
      { userId: f.ada },
      {
        organizationId: f.organizationId,
        workItemId: spec,
      },
    ),
    (e: unknown) =>
      e instanceof Error && "kind" in e && e.kind === "agent_required",
  );
  const mutationId = crypto.randomUUID();
  const claimed = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: spec,
    mutationId,
  });
  assert.equal(claimed.state, "active");
  assert.equal(claimed.status, "In Progress");
  // A retry replays the first answer.
  const replay = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: spec,
    mutationId,
  });
  assert.equal(replay.claimId, claimed.claimId);
  assert.equal(replay.replayed, true);
  // The holder asking again without its retry key (it lost the answer) gets
  // its own claim back, not a conflict; nothing moves twice.
  const again = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: spec,
  });
  assert.equal(again.claimId, claimed.claimId);
  assert.equal(again.alreadyHeld, true);
  assert.equal(again.status, "In Progress");
  assert.equal((await f.item(spec)).statusId, f.statuses["In Progress"]);
  const actions = await f.activity(spec);
  assert.ok(actions.includes("claimed"));
  assert.ok(actions.includes("status_changed"));
  const moved = (
    await db
      .select()
      .from(s.activity)
      .where(
        and(
          eq(s.activity.workItemId, spec),
          eq(s.activity.action, "status_changed"),
        ),
      )
      .orderBy(asc(s.activity.createdAt))
  ).at(-1)!;
  assert.equal(moved.detail?.agentName, "Forge");
  assert.equal(moved.detail?.performedVia, "mcp");
  await assert.rejects(
    claimItem(db, f.agent("Other"), {
      organizationId: f.organizationId,
      workItemId: spec,
    }),
    /cannot be claimed/,
  );
  // External delivery owns execution.
  const other = crypto.randomUUID();
  await f.run({
    type: "createProject",
    projectId: other,
    name: "Billing",
    key: "BIL",
  });
  await f.run({
    type: "updateProject",
    projectId: other,
    deliveryMode: "external",
    iterationMode: "off",
    estimateScale: "none",
  });
  const external = crypto.randomUUID();
  await f.run({
    type: "createWorkItem",
    projectId: other,
    workItemId: external,
    typeId: f.types.Task,
    parentId: null,
    title: "Handed off",
  });
  await assert.rejects(
    claimItem(db, f.agent(), {
      organizationId: f.organizationId,
      workItemId: external,
    }),
    (e: unknown) =>
      e instanceof Error &&
      "kind" in e &&
      e.kind === "external_delivery" &&
      e.message.includes("external tool"),
  );
  assert.deepEqual(await f.drift(), []);
});

void test("concurrent claims of one item: exactly one wins", async () => {
  const f = await fixture();
  const spec = await f.agreed();
  const results = await Promise.allSettled(
    ["A", "B", "C", "D"].map((name) =>
      claimItem(db, f.agent(name), {
        organizationId: f.organizationId,
        workItemId: spec,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const live = await db
    .select()
    .from(s.workItemClaim)
    .where(eq(s.workItemClaim.workItemId, spec));
  assert.equal(live.length, 1);
  assert.deepEqual(await f.drift(), []);
});

void test("leases: renewal keeps a claim, expiry releases it and returns the item", async () => {
  const f = await fixture();
  const spec = await f.agreed();
  const { claimId } = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: spec,
  });
  await assert.rejects(
    renewClaim(db, f.agent("Other"), {
      organizationId: f.organizationId,
      claimId,
    }),
    /Only Forge/,
  );
  const renewed = await renewClaim(db, f.agent(), {
    organizationId: f.organizationId,
    claimId,
    leaseSeconds: 60,
  });
  assert.ok(new Date(renewed.leaseExpiresAt) > new Date());
  // Two minutes later nobody renewed it.
  const later = new Date(Date.now() + 2 * 60_000);
  await runDispatcher(db, { now: () => later });
  const claim = await f.claimRow(claimId);
  assert.equal(claim.state, "released");
  assert.equal(claim.endReason, "expired");
  assert.equal((await f.item(spec)).statusId, f.statuses.Todo);
  assert.equal((await stageOf(f, spec))?.stage, "claimable");
  await assert.rejects(
    renewClaim(db, f.agent(), { organizationId: f.organizationId, claimId }),
    /released/,
  );
  // A lease that ran out does not hold the item against a new claim.
  const again = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: spec,
  });
  await db
    .update(s.workItemClaim)
    .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(s.workItemClaim.id, again.claimId));
  const taken = await claimItem(db, f.agent("Second"), {
    organizationId: f.organizationId,
    workItemId: spec,
  });
  assert.equal((await f.claimRow(again.claimId)).endReason, "expired");
  assert.equal((await f.claimRow(taken.claimId)).state, "active");
  assert.deepEqual(await f.drift(), []);
});

void test("release paths: agent, person, a moved item and closing the item", async () => {
  const f = await fixture();
  const spec = await f.agreed();
  const first = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: spec,
  });
  // Bo reviews but cannot change properties and does not own the claim.
  await assert.rejects(
    releaseClaim(
      db,
      { userId: f.bo },
      {
        organizationId: f.organizationId,
        claimId: first.claimId,
      },
    ),
    /can release this claim/,
  );
  const released = await releaseClaim(db, f.agent(), {
    organizationId: f.organizationId,
    claimId: first.claimId,
    note: "Needs a database migration I cannot run.",
  });
  assert.equal(released.returnedTo, "Todo");
  // The result echoes the note it was given.
  assert.equal(released.note, "Needs a database migration I cannot run.");
  assert.equal((await f.claimRow(first.claimId)).endReason, "agent");

  // A person moved the item meanwhile: it stays where they put it.
  const second = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: spec,
  });
  await f.run({
    type: "updateWorkItem",
    workItemId: spec,
    statusId: f.statuses["Code review"],
  });
  const kept = await releaseClaim(
    db,
    { userId: f.ada },
    {
      organizationId: f.organizationId,
      claimId: second.claimId,
    },
  );
  assert.equal(kept.returnedTo, null);
  assert.equal(kept.note, null);
  assert.match(String(kept.returnNote), /stays where it is|moved/);
  assert.equal((await f.item(spec)).statusId, f.statuses["Code review"]);
  assert.equal((await f.claimRow(second.claimId)).endReason, "person");

  // Moving claimed work back out of progress releases the claim.
  const task = await f.create(f.types.Task, { statusId: f.statuses.Todo });
  const third = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: task,
  });
  await f.run({
    type: "updateWorkItem",
    workItemId: task,
    statusId: f.statuses.Backlog,
  });
  assert.equal((await f.claimRow(third.claimId)).endReason, "item_moved");

  // An agent cannot report claimed work done; a person can.
  const fourth = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: task,
  }).catch(async () => {
    await f.run({
      type: "updateWorkItem",
      workItemId: task,
      statusId: f.statuses.Todo,
    });
    return claimItem(db, f.agent(), {
      organizationId: f.organizationId,
      workItemId: task,
    });
  });
  await assert.rejects(
    executeMutation(db, f.agent(), {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId: f.organizationId,
      command: {
        type: "updateWorkItem",
        workItemId: task,
        statusId: f.statuses.Done,
      },
    }),
    (e: unknown) =>
      e instanceof Error && "kind" in e && e.kind === "evidence_required",
  );
  await reportProgress(db, f.agent(), {
    organizationId: f.organizationId,
    claimId: fourth.claimId,
    note: "Tests pass locally; opening the pull request.",
  });
  assert.equal((await f.item(task)).statusId, f.statuses["In Progress"]);
  assert.ok((await f.activity(task)).includes("claim_progress"));
  await f.run({
    type: "updateWorkItem",
    workItemId: task,
    statusId: f.statuses.Done,
  });
  const done = await f.claimRow(fourth.claimId);
  assert.equal(done.state, "completed");
  assert.equal(done.endReason, "moved_to_done");
  assert.deepEqual(await f.drift(), []);
});

void test("questions: a blocking discussion on the exact text, waiting, and resume on resolution", async () => {
  const f = await fixture();
  const events: SessionResumeEvent[] = [];
  configureClaimPorts({
    resumer: {
      resume: (_tx, event) => {
        events.push(event);
        return Promise.resolve();
      },
    },
  });
  const epic = await f.create(f.types.Epic);
  await f.makeReady(epic);
  await f.accept(epic);
  const task = await f.create(f.types.Task, { parentId: epic });
  const sibling = await f.create(f.types.Task, { parentId: epic });
  const { claimId } = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: task,
  });
  const revisions = async () =>
    (
      await db
        .select()
        .from(s.specificationRevision)
        .where(eq(s.specificationRevision.workItemId, epic))
    ).length;
  const before = await revisions();
  await assert.rejects(
    askQuestion(db, f.agent(), {
      organizationId: f.organizationId,
      claimId,
      question: "Which ID?",
      section: "Behavior",
      quote: "a sentence that is not there",
    }),
    /not in section/,
  );
  const asked = await askQuestion(db, f.agent(), {
    organizationId: f.organizationId,
    claimId,
    question: "Does a partial refund also reuse the original ID?",
    section: "Behavior",
    quote: "reuse the original transaction ID",
  });
  assert.equal(asked.questionItemId, epic);
  assert.equal(asked.blocking, true);
  assert.deepEqual(asked.asked, [f.bo]);
  assert.equal((await f.claimRow(claimId)).state, "waiting");
  const [thread] = await db
    .select()
    .from(s.thread)
    .where(eq(s.thread.id, asked.threadId));
  assert.equal(thread!.blocking, true);
  assert.equal(thread!.anchor?.quote, "reuse the original transaction ID");
  assert.equal(thread!.workItemId, epic);
  // The question blocks the agreed scope: sibling work waits too.
  assert.deepEqual(await codes(f, sibling), ["parent_not_ready"]);
  // Bo is asked by mention.
  const [message] = await db
    .select()
    .from(s.threadMessage)
    .where(eq(s.threadMessage.threadId, asked.threadId));
  assert.match(message!.body, new RegExp(`mention:${f.bo}`));
  // A waiting claim does not expire.
  await runDispatcher(db, { now: () => new Date(Date.now() + 60 * 60_000) });
  assert.equal((await f.claimRow(claimId)).state, "waiting");
  // A person resolves it: the claim resumes and its session is told.
  await f.run(
    {
      type: "setThreadState",
      workItemId: epic,
      threadId: asked.threadId,
      resolved: true,
      blocking: true,
    },
    f.bo,
  );
  const claim = await f.claimRow(claimId);
  assert.equal(claim.state, "active");
  const resumed = events.find((e) => e.kind === "question_resolved");
  assert.ok(resumed?.kind === "question_resolved");
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.resolvedById, f.bo);
  assert.equal(resumed.claimId, claimId);
  // Questions never change the specification.
  assert.equal(await revisions(), before);
  assert.ok((await f.activity(task)).includes("claim_question_resolved"));
  assert.deepEqual(await f.drift(), []);
});

const agents = (f: Fixture): FactoryAgent[] => [
  {
    id: "forge",
    name: "Forge",
    ownerId: f.ada,
    projectIds: null,
    dispatchable: true,
  },
  {
    id: "anvil",
    name: "Anvil",
    ownerId: f.ada,
    projectIds: null,
    dispatchable: true,
  },
  {
    id: "lens",
    name: "Lens",
    ownerId: f.ada,
    projectIds: null,
    dispatchable: false,
  },
  {
    id: "bo-bot",
    name: "Bo's bot",
    ownerId: f.bo,
    projectIds: null,
    dispatchable: true,
  },
];

void test("autonomy policy: project administrators only, validated, audited and reversible", async () => {
  const f = await fixture();
  configureClaimPorts({
    agents: { agents: () => Promise.resolve(agents(f)) },
  });
  const set = (
    policy: Partial<typeof defaultAutonomyPolicy>,
    userId = f.ada,
    expectedVersion?: number,
  ) =>
    setAutonomyPolicy(
      db,
      { userId },
      {
        organizationId: f.organizationId,
        projectId: f.projectId,
        policy: { ...defaultAutonomyPolicy, ...policy },
        expectedVersion,
      },
    );
  await assert.rejects(
    set({ level: "build", implementerAgentIds: ["forge"] }, f.bo),
    /Only project administrators/,
  );
  await assert.rejects(
    set({ level: "build", implementerAgentIds: [] }),
    /at least one implementer/,
  );
  await assert.rejects(
    set({ level: "build", implementerAgentIds: ["lens"] }),
    /not a runner agent/,
  );
  await assert.rejects(
    set({ level: "build", implementerAgentIds: ["bo-bot"] }),
    /cannot change properties/,
  );
  const built = await set({
    level: "build",
    implementerAgentIds: ["forge"],
    reviewerAgentId: "lens",
  });
  assert.equal(built.version, 1);
  await assert.rejects(set({ level: "assist" }, f.ada, 0), /changed/);
  // A claim in flight survives lowering autonomy.
  const spec = await f.agreed();
  const { claimId } = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: spec,
  });
  const lowered = await set({ level: "assist" }, f.ada, 1);
  assert.equal(lowered.previousLevel, "build");
  assert.equal(lowered.claimsInFlight, 1);
  assert.equal((await f.claimRow(claimId)).state, "active");
  const audit = await db
    .select()
    .from(s.configurationAudit)
    .where(
      and(
        eq(s.configurationAudit.organizationId, f.organizationId),
        eq(s.configurationAudit.action, "setAutonomyPolicy"),
      ),
    );
  assert.equal(audit.length, 2);
  const last = audit.find(
    (a) =>
      (a.detail as { previous?: { level?: string } }).previous?.level ===
      "build",
  );
  assert.ok(last);
  assert.deepEqual(await f.drift(), []);
});

void test("dispatcher: rank order up to the concurrency limit, never two sessions for one item", async () => {
  const f = await fixture();
  const launched: SessionLaunch[] = [];
  configureClaimPorts({
    agents: { agents: () => Promise.resolve(agents(f)) },
    launcher: {
      launch: (request) => {
        launched.push(request);
        return Promise.resolve({
          started: true,
          sessionId: `session-${launched.length}`,
        });
      },
    },
  });
  const items = [await f.agreed(), await f.agreed(), await f.agreed()];
  await setAutonomyPolicy(
    db,
    { userId: f.ada },
    {
      organizationId: f.organizationId,
      projectId: f.projectId,
      policy: {
        ...defaultAutonomyPolicy,
        level: "build",
        implementerAgentIds: ["forge", "anvil"],
        maxConcurrentSessions: 2,
      },
    },
  );
  await Promise.all([runDispatcher(db), runDispatcher(db)]);
  assert.equal(launched.length, 2);
  assert.deepEqual(
    launched.map((l) => l.workItemId),
    items.slice(0, 2),
  );
  assert.deepEqual(
    new Set(launched.map((l) => l.agentId)),
    new Set(["forge", "anvil"]),
  );
  for (const id of items.slice(0, 2)) {
    assert.equal((await f.item(id)).statusId, f.statuses["In Progress"]);
    const [claim] = await db
      .select()
      .from(s.workItemClaim)
      .where(eq(s.workItemClaim.workItemId, id));
    assert.equal(claim!.state, "active");
    assert.equal(claim!.source, "dispatcher");
    assert.ok(claim!.agentSessionId?.startsWith("session-"));
  }
  // Full: another run starts nothing.
  await runDispatcher(db);
  assert.equal(launched.length, 2);
  assert.equal((await f.item(items[2]!)).statusId, f.statuses.Todo);
  const moved = (
    await db
      .select()
      .from(s.activity)
      .where(
        and(
          eq(s.activity.workItemId, items[0]!),
          eq(s.activity.action, "status_changed"),
        ),
      )
      .orderBy(asc(s.activity.createdAt))
  ).at(-1)!;
  assert.equal(moved.detail?.automation, "dispatcher");
  assert.equal(moved.detail?.performedVia, "runner");
  assert.deepEqual(await f.drift(), []);
});

void test("dispatcher: never takes a person's assigned work or a container, and attributes the start to the policy", async () => {
  const f = await fixture();
  const launched: SessionLaunch[] = [];
  configureClaimPorts({
    agents: { agents: () => Promise.resolve(agents(f)) },
    launcher: {
      launch: (request) => {
        launched.push(request);
        return Promise.resolve({
          started: true,
          sessionId: `session-${launched.length}`,
        });
      },
    },
  });
  // Bo's bug-like work, Ada's own work, unassigned work.
  const bos = await f.agreed();
  await f.run({ type: "updateWorkItem", workItemId: bos, assigneeId: f.bo });
  const adas = await f.agreed();
  await f.run({ type: "updateWorkItem", workItemId: adas, assigneeId: f.ada });
  const open = await f.agreed();
  // An agreed Epic: its unassigned children are the work, never the Epic.
  const epic = await f.create(f.types.Epic);
  await f.makeReady(epic);
  await f.accept(epic);
  const child = await f.create(f.types.Task, { parentId: epic });
  // An agreed container is outside the factory's queue.
  assert.equal(await stageOf(f, epic), undefined);
  await assert.rejects(
    claimItem(db, f.agent(), {
      organizationId: f.organizationId,
      workItemId: epic,
    }),
    /groups implementation work/,
  );
  assert.equal((await stageOf(f, child))?.stage, "claimable");
  await setAutonomyPolicy(
    db,
    { userId: f.ada },
    {
      organizationId: f.organizationId,
      projectId: f.projectId,
      policy: {
        ...defaultAutonomyPolicy,
        level: "build",
        implementerAgentIds: ["forge"],
        maxConcurrentSessions: 10,
      },
    },
  );
  await runDispatcher(db);
  // Forge acts for Ada: Ada's own work and unassigned work only.
  assert.deepEqual(
    new Set(launched.map((l) => l.workItemId)),
    new Set([adas, open, child]),
  );
  assert.equal((await f.item(bos)).statusId, f.statuses.Todo);
  // The policy started it; Ada, who set it, is named, and stays the
  // accountable actor.
  const [claimed] = await db
    .select()
    .from(s.activity)
    .where(
      and(eq(s.activity.workItemId, open), eq(s.activity.action, "claimed")),
    );
  assert.equal(claimed!.actorId, f.ada);
  assert.equal(claimed!.detail?.policyLabel, "Build policy (set by Ada)");
  assert.deepEqual(claimed!.detail?.policy, {
    level: "build",
    setById: f.ada,
  });
  assert.deepEqual(await f.drift(), []);
});

void test("dispatcher: failed starts back off, then hold until a person retries", async () => {
  const f = await fixture();
  let attempts = 0;
  configureClaimPorts({
    agents: { agents: () => Promise.resolve(agents(f)) },
    launcher: {
      launch: () => {
        attempts++;
        return Promise.resolve({
          started: false,
          reason: "No runner is online.",
          retryable: true,
        });
      },
    },
  });
  const spec = await f.agreed();
  await setAutonomyPolicy(
    db,
    { userId: f.ada },
    {
      organizationId: f.organizationId,
      projectId: f.projectId,
      policy: {
        ...defaultAutonomyPolicy,
        level: "build",
        implementerAgentIds: ["forge"],
      },
    },
  );
  let now = Date.now();
  await runDispatcher(db, { now: () => new Date(now) });
  assert.equal(attempts, 1);
  assert.equal((await f.item(spec)).statusId, f.statuses.Todo);
  // Within the backoff nothing is tried.
  await runDispatcher(db, { now: () => new Date(now + 60_000) });
  assert.equal(attempts, 1);
  for (const wait of [6 * 60_000, 21 * 60_000]) {
    now += wait;
    await runDispatcher(db, { now: () => new Date(now) });
  }
  assert.equal(attempts, 3);
  const [backoff] = await db
    .select()
    .from(s.dispatchBackoff)
    .where(eq(s.dispatchBackoff.workItemId, spec));
  assert.equal(backoff!.failures, 3);
  now += 24 * 60 * 60_000;
  await runDispatcher(db, { now: () => new Date(now) });
  assert.equal(attempts, 3, "held after three failures");
  await retryDispatch(
    db,
    { userId: f.ada },
    {
      organizationId: f.organizationId,
      workItemId: spec,
    },
  );
  await runDispatcher(db, { now: () => new Date(now) });
  assert.equal(attempts, 4);
  assert.ok((await f.activity(spec)).includes("claim_dispatch_failed"));
  assert.deepEqual(await f.drift(), []);
});

const pr = (
  state: "open" | "merged",
  overrides: Partial<{
    failing: string[];
    pending: string[];
    approvals: { agentId: string | null; userId: string | null }[];
  }> = {},
) => ({
  id: "pr-1",
  title: "Reuse transaction IDs",
  url: "https://code.example/pr/1",
  state,
  headSha: "abc123",
  checks: {
    required: 2,
    failing: overrides.failing ?? [],
    pending: overrides.pending ?? [],
  },
  approvals: overrides.approvals ?? [],
  mergeable: true,
});

void test("dispatcher: work with a person's linked pull request is not dispatched; an agent's earlier pull request is retried", async () => {
  const f = await fixture();
  const launched: SessionLaunch[] = [];
  const human = await f.agreed();
  const merged = await f.agreed();
  const retried = await f.agreed();
  const evidence = new Map<string, CodeEvidence>([
    [
      human,
      {
        connected: true,
        pullRequests: [
          { ...pr("open"), number: 12, openedByAgent: false, authorId: f.ada },
        ],
      },
    ],
    [
      merged,
      {
        connected: true,
        pullRequests: [
          {
            ...pr("merged"),
            number: 14,
            openedByAgent: false,
            authorId: null,
            authorLogin: "octo-bo",
          },
        ],
      },
    ],
    [
      retried,
      {
        connected: true,
        // Opened by an agent session whose claim was released.
        pullRequests: [{ ...pr("open"), number: 15, openedByAgent: true }],
      },
    ],
  ]);
  configureClaimPorts({
    agents: { agents: () => Promise.resolve(agents(f)) },
    launcher: {
      launch: (request) => {
        launched.push(request);
        return Promise.resolve({
          started: true,
          sessionId: `session-${launched.length}`,
        });
      },
    },
    evidence: {
      evidence: (_tx, _org, ids) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              evidence.get(id) ?? { connected: true, pullRequests: [] },
            ]),
          ),
        ),
    },
  });
  const open = await stageOf(f, human);
  assert.equal(open?.stage, "blocked");
  assert.deepEqual(
    open?.reasons.map((r) => r.code),
    ["pull_request_linked"],
  );
  assert.match(
    open?.reasons[0]?.message ?? "",
    /^A pull request is already linked: #12 by Ada\./,
  );
  const done = await stageOf(f, merged);
  assert.deepEqual(
    done?.reasons.map((r) => r.code),
    ["pull_request_linked"],
  );
  assert.match(
    done?.reasons[0]?.message ?? "",
    /#14 by octo-bo \(merged\)\. octo-bo is a code host login no member has linked\./,
  );
  assert.equal((await stageOf(f, retried))?.stage, "claimable");
  // An agent acting on its own is refused too.
  await assert.rejects(
    claimItem(db, f.agent(), {
      organizationId: f.organizationId,
      workItemId: human,
    }),
    /already linked: #12 by Ada/,
  );
  // A person may still start an agent on it: its session claims.
  const agentId = crypto.randomUUID();
  await db.insert(s.agent).values({
    id: agentId,
    organizationId: f.organizationId,
    handle: "forge",
    name: "Forge",
    ownerId: f.ada,
    kind: "runner",
    createdById: f.ada,
  });
  const started = async (
    sessionId: string,
    workItemId: string,
    policy: boolean,
  ) =>
    db.insert(s.agentSession).values({
      id: sessionId,
      organizationId: f.organizationId,
      agentId,
      requestedById: f.ada,
      title: "Implement",
      prompt: "Implement it",
      workItemId,
      ...(policy
        ? { startedByPolicy: { level: "build", setById: f.ada } }
        : {}),
    } as typeof s.agentSession.$inferInsert);
  await started("by-policy", human, true);
  await assert.rejects(
    claimItem(
      db,
      { ...f.agent(), agentSessionId: "by-policy" },
      {
        organizationId: f.organizationId,
        workItemId: human,
      },
    ),
    /already linked/,
  );
  await started("by-ada", human, false);
  const explicit = await claimItem(
    db,
    { ...f.agent(), agentSessionId: "by-ada" },
    { organizationId: f.organizationId, workItemId: human },
  );
  await releaseClaim(
    db,
    { ...f.agent(), agentSessionId: "by-ada" },
    {
      organizationId: f.organizationId,
      claimId: explicit.claimId,
    },
  );
  await setAutonomyPolicy(
    db,
    { userId: f.ada },
    {
      organizationId: f.organizationId,
      projectId: f.projectId,
      policy: {
        ...defaultAutonomyPolicy,
        level: "build",
        implementerAgentIds: ["forge"],
        maxConcurrentSessions: 10,
      },
    },
  );
  await runDispatcher(db);
  assert.deepEqual(
    launched.map((l) => l.workItemId),
    [retried],
  );
  assert.equal((await f.item(human)).statusId, f.statuses.Todo);
  assert.equal((await f.item(merged)).statusId, f.statuses.Todo);
  assert.deepEqual(await f.drift(), []);
});

void test("claimability: the reason for people names no command; agents still learn it", async () => {
  const f = await fixture();
  const spec = await f.create(f.types.Story);
  const [reason] = (await stageOf(f, spec))?.reasons ?? [];
  assert.equal(reason?.code, "scope_not_accepted");
  assert.doesNotMatch(reason?.message ?? "", /acceptDeliveryScope/);
  assert.equal(reason?.command, "acceptDeliveryScope");
  await assert.rejects(
    claimItem(db, f.agent(), {
      organizationId: f.organizationId,
      workItemId: spec,
    }),
    /\(acceptDeliveryScope\)/,
  );
});

void test("Definition of Done: evidence completes the item and records the delivered revision", async () => {
  const f = await fixture();
  const spec = await f.agreed();
  const accepted = (await f.item(spec)).committedRevisionId;
  const { claimId } = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: spec,
  });
  // No code host connected: the checks say so.
  const [evaluation] = await db
    .select()
    .from(s.syncEntity)
    .where(eq(s.syncEntity.key, `doneEvaluation:${spec}`));
  const data = evaluation!.data as {
    passed: boolean;
    checks: { passed: boolean; detail: string }[];
  };
  assert.equal(data.passed, false);
  assert.match(data.checks[0]!.detail, /No code host is connected/);
  let evidence: CodeEvidence = {
    connected: true,
    pullRequests: [pr("open", { pending: ["ci"] })],
  };
  configureClaimPorts({
    evidence: {
      evidence: (_tx, _org, ids) =>
        Promise.resolve(new Map(ids.map((id) => [id, evidence]))),
    },
  });
  const follow = () =>
    db.transaction((tx) =>
      followDefinitionOfDone(tx, f.organizationId, [spec]),
    );
  assert.equal((await follow()).completed, 0);
  evidence = { connected: true, pullRequests: [pr("merged")] };
  assert.equal((await follow()).completed, 1);
  const item = await f.item(spec);
  assert.equal(item.statusId, f.statuses.Done);
  assert.equal(item.deliveredRevisionId, accepted);
  const claim = await f.claimRow(claimId);
  assert.equal(claim.state, "completed");
  assert.equal(claim.endReason, "definition_of_done");
  assert.equal(claim.deliveredRevisionId, accepted);
  const actions = await f.activity(spec);
  assert.ok(actions.includes("definition_of_done_passed"));
  assert.ok(actions.includes("delivery_scope_completed"));
  assert.deepEqual(await f.drift(), []);
});

void test("Definition of Done: acceptance sign-off by the chosen discipline and recorded overrides", async () => {
  const f = await fixture();
  configureClaimPorts({
    evidence: {
      evidence: (_tx, _org, ids) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              { connected: true, pullRequests: [pr("merged")] },
            ]),
          ),
        ),
    },
  });
  await setDefinitionOfDone(
    db,
    { userId: f.ada },
    {
      organizationId: f.organizationId,
      projectId: f.projectId,
      checks: [
        { id: "merged", kind: "pull_request_merged" },
        { id: "ci", kind: "checks_passed" },
        { id: "review", kind: "code_review_approved" },
        {
          id: "qa",
          kind: "acceptance_verified",
          label: "QA verified the acceptance criteria",
          disciplineIds: [f.roles.QA],
        },
      ],
    },
  );
  const spec = await f.agreed();
  await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: spec,
  });
  // Ada holds no QA discipline.
  await assert.rejects(
    signOffDoneCheck(
      db,
      { userId: f.ada },
      {
        organizationId: f.organizationId,
        workItemId: spec,
        checkId: "qa",
        signedOff: true,
      },
    ),
    /Only members of QA/,
  );
  await signOffDoneCheck(
    db,
    { userId: f.bo },
    {
      organizationId: f.organizationId,
      workItemId: spec,
      checkId: "qa",
      signedOff: true,
    },
  );
  assert.equal((await f.item(spec)).statusId, f.statuses["In Progress"]);
  // Bo cannot change properties, so cannot override the review check.
  await assert.rejects(
    overrideDoneCheck(
      db,
      { userId: f.bo },
      {
        organizationId: f.organizationId,
        workItemId: spec,
        checkId: "review",
        overridden: true,
        reason: "Reviewed in a call.",
      },
    ),
    /change properties/,
  );
  await assert.rejects(
    overrideDoneCheck(
      db,
      { userId: f.ada },
      {
        organizationId: f.organizationId,
        workItemId: spec,
        checkId: "review",
        overridden: true,
      },
    ),
    /Say why/,
  );
  const result = await overrideDoneCheck(
    db,
    { userId: f.ada },
    {
      organizationId: f.organizationId,
      workItemId: spec,
      checkId: "review",
      overridden: true,
      reason: "Reviewed together in the pairing session.",
    },
  );
  assert.equal(result.completed, true);
  assert.equal((await f.item(spec)).statusId, f.statuses.Done);
  const actions = await f.activity(spec);
  assert.ok(actions.includes("done_signed_off"));
  assert.ok(actions.includes("done_check_overridden"));
  // An override stands in for evidence, so the organization's audit log
  // records it too (a sign-off is evidence and stays in the item's history).
  const audited = await db
    .select()
    .from(s.auditEvent)
    .where(eq(s.auditEvent.organizationId, f.organizationId));
  const override = audited.filter((e) => e.action === "done_check.overridden");
  assert.equal(override.length, 1);
  assert.equal(override[0]!.actorId, f.ada);
  assert.equal(override[0]!.targetId, spec);
  assert.match(override[0]!.targetLabel ?? "", /^[A-Z]+-\d+$/);
  assert.deepEqual(
    {
      checkId: override[0]!.detail.checkId,
      reason: override[0]!.detail.reason,
    },
    { checkId: "review", reason: "Reviewed together in the pairing session." },
  );
  assert.ok(!audited.some((e) => e.action.includes("sign")));
  assert.deepEqual(await f.drift(), []);
});

void test("Autopilot requests the merge once, attributed to the policy and its administrator", async () => {
  const f = await fixture();
  const merges: MergeRequest[] = [];
  let evidence: CodeEvidence = {
    connected: true,
    pullRequests: [pr("open", { approvals: [] })],
  };
  configureClaimPorts({
    agents: { agents: () => Promise.resolve(agents(f)) },
    evidence: {
      evidence: (_tx, _org, ids) =>
        Promise.resolve(new Map(ids.map((id) => [id, evidence]))),
    },
    merges: {
      requestMerge: (_tx, request) => {
        merges.push(request);
        return Promise.resolve({ requested: true });
      },
    },
  });
  const spec = await f.agreed();
  await setAutonomyPolicy(
    db,
    { userId: f.ada },
    {
      organizationId: f.organizationId,
      projectId: f.projectId,
      policy: {
        ...defaultAutonomyPolicy,
        level: "autopilot",
        implementerAgentIds: ["forge"],
        reviewerAgentId: "lens",
      },
    },
  );
  const { claimId } = await claimItem(db, f.agent(), {
    organizationId: f.organizationId,
    workItemId: spec,
  });
  const follow = () =>
    db.transaction((tx) =>
      followDefinitionOfDone(tx, f.organizationId, [spec]),
    );
  await follow();
  assert.equal(merges.length, 0, "the reviewer agent has not approved");
  evidence = {
    connected: true,
    pullRequests: [
      pr("open", { approvals: [{ agentId: "lens", userId: null }] }),
    ],
  };
  await follow();
  await follow();
  await runDispatcher(db);
  assert.equal(merges.length, 1);
  assert.equal(merges[0]!.authorizedById, f.ada);
  assert.equal(merges[0]!.policyVersion, 1);
  assert.equal(merges[0]!.headSha, "abc123");
  const [row] = await db
    .select()
    .from(s.autopilotMerge)
    .where(eq(s.autopilotMerge.workItemId, spec));
  assert.equal(row!.outcome, "requested");
  assert.equal(row!.claimId, claimId);
  const requested = (
    await db
      .select()
      .from(s.activity)
      .where(
        and(
          eq(s.activity.workItemId, spec),
          eq(s.activity.action, "autopilot_merge_requested"),
        ),
      )
  )[0]!;
  assert.equal(requested.actorId, f.ada);
  assert.equal(requested.detail?.automation, "autopilot");
  // The merge lands: the Definition of Done completes the item.
  evidence = {
    connected: true,
    pullRequests: [
      pr("merged", { approvals: [{ agentId: "lens", userId: null }] }),
    ],
  };
  await follow();
  assert.equal((await f.item(spec)).statusId, f.statuses.Done);
  assert.deepEqual(await f.drift(), []);
});

void test("MCP agents claim through the capability layer; autonomy stays with people", async () => {
  const f = await fixture();
  const spec = await f.agreed();
  const [token] = await db
    .insert(s.accessToken)
    .values({
      userId: f.ada,
      name: "Forge",
      scope: "write",
      prefix: "lct_test",
      tokenHash: crypto.randomUUID(),
    })
    .returning();
  const mcp = {
    db,
    effects: noEffects,
    principal: {
      userId: f.ada,
      surface: "mcp" as const,
      tokenId: token!.id,
      agentName: "Forge",
      access: "write" as const,
    },
  };
  const listed = (await invoke(mcp, "listClaimableItems", {
    organizationId: f.organizationId,
    projectId: f.projectId,
  })) as { items: { workItemId: string }[] };
  assert.deepEqual(
    listed.items.map((i) => i.workItemId),
    [spec],
  );
  const claimed = (await invoke(mcp, "claimItem", {
    organizationId: f.organizationId,
    workItemId: spec,
  })) as { claimId: string };
  const claim = await f.claimRow(claimed.claimId);
  assert.equal(claim.agentId, token!.id);
  assert.equal(claim.agentName, "Forge");
  await assert.rejects(
    invoke(mcp, "setAutonomyPolicy", {
      organizationId: f.organizationId,
      projectId: f.projectId,
      policy: defaultAutonomyPolicy,
    }),
    (e: unknown) =>
      e instanceof Error &&
      "details" in e &&
      (e.details as { kind?: string }).kind === "human_only",
  );
  const done = (await invoke(mcp, "getDefinitionOfDone", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    workItemId: spec,
  })) as { checks: unknown[]; evaluation: { passed: boolean } | null };
  assert.equal(done.checks.length, 2);
  assert.equal(done.evaluation?.passed, false);
  assert.deepEqual(await f.drift(), []);
});

void test("accepting a scope wakes the dispatcher on commit instead of its next round", async () => {
  const f = await fixture();
  const id = await f.create(f.types.Story);
  await f.makeReady(id);
  const signals: string[] = [];
  const listener = postgres(url.toString(), {
    max: 1,
    onnotice: () => undefined,
  });
  const subscription = await listener.listen(WORK_CHANNEL, (kind) =>
    signals.push(kind),
  );
  try {
    await f.accept(id);
    const deadline = Date.now() + 5_000;
    while (!signals.includes("factory") && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(signals.includes("factory"), JSON.stringify(signals));
  } finally {
    await subscription.unlisten();
    await listener.end();
  }
});
