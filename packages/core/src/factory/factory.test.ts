import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { MockLanguageModelV4 } from "ai/test";
import * as s from "@lictory/core/db/schema";
import { seedOrganization } from "@lictory/core/domain/organization";
import { authenticateAccessToken } from "@lictory/core/capabilities/access-tokens";
import {
  noEffects,
  type CapabilityContext,
  type Principal,
} from "@lictory/core/capabilities/core";
import { invoke } from "@lictory/core/capabilities/registry";
import { resolveAgentHandle } from "@lictory/core/factory/agents";
import { postMessage } from "@lictory/core/channels/writer";
import { PROTOCOL } from "@lictory/core/contracts/protocol";
import { executeMutation } from "@lictory/core/domain/service";
import { decodeWire } from "@lictory/core/factory/model-wire";
import { sessionTitle, waitsForRunner } from "@lictory/core/factory/entities";
import { describeNotification } from "@lictory/core/notifications/format";
import { proxyModelStream } from "@lictory/core/factory/model-proxy";
import {
  authenticateRunner,
  heartbeat,
  registerRunner,
  type RunnerRow,
} from "@lictory/core/factory/runners";
import {
  SequenceGap,
  appendRunnerEvents,
  claimSession,
  completeRun,
  modelAccess,
  readInputs,
  recoverExpiredSessions,
  startRun,
} from "@lictory/core/factory/sessions";
import {
  setSessionThreadPublisher,
  type SessionThreadEvent,
} from "@lictory/core/factory/ports";
import type {
  AgentEntity,
  SessionEntity,
} from "@lictory/core/factory/entities";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_factory_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 6, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;
// AI settings of the developer's environment never change the outcome.
const aiSettings = Object.keys(process.env).filter(
  (k) => k.startsWith("LICTORY_AI_") || k.startsWith("OPENAI_"),
);
const saved = Object.fromEntries(aiSettings.map((k) => [k, process.env[k]]));
for (const k of aiSettings) delete process.env[k];
before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  for (const k of aiSettings)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  setSessionThreadPublisher(null);
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`;
  await admin.end();
});

const context = (principal: Principal): CapabilityContext => ({
  db,
  principal,
  effects: noEffects,
});
const web = (userId: string) => context({ userId, surface: "web" });

async function user(name: string, handle?: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({
    id,
    name,
    email: `${id}@example.test`,
    handle: handle ?? null,
  });
  return id;
}

async function organization(ownerId: string, memberIds: string[] = []) {
  const organizationId = crypto.randomUUID();
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Northwind",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [ownerId, ...memberIds].map((userId, index) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: index === 0 ? "owner" : "member",
      createdAt: new Date(),
    })),
  );
  await seedOrganization(db, organizationId);
  return organizationId;
}

async function project(ownerId: string, organizationId: string, key: string) {
  const projectId = crypto.randomUUID();
  await invoke(web(ownerId), "createProject", {
    organizationId,
    projectId,
    name: key,
    key,
  });
  return projectId;
}

async function storyType(userId: string, organizationId: string) {
  const workspace = (await invoke(web(userId), "getWorkspace", {
    organizationId,
  })) as { types: { id: string; name: string }[] };
  return workspace.types.find((t) => t.name === "Story")!.id;
}

async function workItem(
  ctx: CapabilityContext,
  organizationId: string,
  projectId: string,
  typeId: string,
  title = "Refunds over the API",
) {
  const result = (await invoke(ctx, "createWorkItem", {
    organizationId,
    projectId,
    typeId,
    parentId: null,
    title,
    description: "Customers want refunds over the API.",
  })) as { workItemId: string };
  return result.workItemId;
}

async function createAgent(
  userId: string,
  organizationId: string,
  fields: Record<string, unknown> = {},
) {
  const { agent } = (await invoke(web(userId), "createAgent", {
    organizationId,
    kind: "runner",
    name: "Forge",
    handle: `forge_${crypto.randomUUID().slice(0, 6)}`,
    harness: "claude-code",
    access: "write",
    ...fields,
  })) as { agent: AgentEntity };
  return agent;
}

// An MCP principal acting as the agent, from a token minted in the browser.
async function agentPrincipal(
  ownerId: string,
  organizationId: string,
  agentId: string,
): Promise<Principal> {
  const { secret } = (await invoke(web(ownerId), "createAgentToken", {
    organizationId,
    agentId,
    expiresInDays: 30,
  })) as { secret: string };
  const token = (await authenticateAccessToken(db, secret))!;
  return {
    userId: token.userId,
    surface: "mcp",
    tokenId: token.tokenId,
    agentName: token.name,
    agent: token.agent,
    access: token.access,
  };
}

const machine = {
  os: "linux",
  arch: "x64",
  version: "0.1.0",
  hostname: "build-1",
  harnesses: [
    { id: "claude-code" as const, version: "2.1.0" },
    { id: "lictory" as const, version: null },
  ],
  maxSessions: 2,
  isolation: "host" as const,
};

async function runner(
  userId: string,
  organizationId: string,
  personal: boolean,
  overrides: Partial<typeof machine> = {},
): Promise<RunnerRow> {
  const { token } = (await invoke(web(userId), "createRunnerRegistration", {
    organizationId,
    personal,
  })) as { token: string };
  const registered = await registerRunner(db, {
    ...machine,
    ...overrides,
    token,
    name: personal ? "laptop" : "build-1",
  });
  return (await authenticateRunner(db, registered.credential))!;
}

async function start(
  userId: string,
  organizationId: string,
  agentId: string,
  fields: Record<string, unknown> = {},
) {
  const { session } = (await invoke(web(userId), "startAgentSession", {
    organizationId,
    agentId,
    prompt: "Implement refunds over the API.",
    ...fields,
  })) as { session: SessionEntity };
  return session;
}

async function refused(
  call: Promise<unknown>,
  category: string,
  kind?: string,
) {
  await assert.rejects(call, (error: unknown) => {
    // Capability errors carry the kind in details, domain errors directly.
    const e = error as {
      category: string;
      message: string;
      kind?: string;
      details?: { kind?: string };
    };
    assert.equal(e.category, category, e.message);
    if (kind) assert.equal(e.details?.kind ?? e.kind, kind);
    return true;
  });
}

async function sessionRow(id: string) {
  const [row] = await db
    .select()
    .from(s.agentSession)
    .where(eq(s.agentSession.id, id));
  return row!;
}

async function eventsOf(id: string) {
  return db
    .select()
    .from(s.agentSessionEvent)
    .where(eq(s.agentSessionEvent.sessionId, id))
    .orderBy(s.agentSessionEvent.sequence);
}

const event = (seq: number, text = `step ${seq}`) => ({
  seq,
  type: "message",
  data: { text },
});

// ---------------------------------------------------------------- tests

void test("an agent's owner sees what it called, refusals included; nobody else does", async () => {
  const ownerId = await user("Ada");
  const memberId = await user("Grace");
  const organizationId = await organization(ownerId, [memberId]);
  const scout = await createAgent(ownerId, organizationId, {
    kind: "external",
    name: "Scout",
    harness: undefined,
  });
  const agent = context(
    await agentPrincipal(ownerId, organizationId, scout.id),
  );
  await invoke(agent, "listOrganizations", {});
  await invoke(agent, "getWorkspace", { organizationId });
  await refused(
    invoke(agent, "getWorkItem", { organizationId, key: "NOPE-1" }),
    "not_found",
  );
  // A person's decision is refused to the agent, whatever it names.
  await refused(
    invoke(agent, "answerAgentApproval", {
      organizationId,
      sessionId: "session-1",
      approvalId: "approval-1",
      decision: "approve",
    }),
    "forbidden",
    "human_only",
  );
  const { calls } = (await invoke(web(ownerId), "listAgentActivity", {
    organizationId,
    agentId: scout.id,
  })) as {
    calls: {
      capability: string;
      outcome: string;
      detail: {
        target?: { field: string; id: string };
        message?: string;
        kind?: string;
      } | null;
    }[];
  };
  assert.deepEqual(
    calls.map((c) => [c.capability, c.outcome]),
    [
      ["answerAgentApproval", "forbidden"],
      ["getWorkItem", "not_found"],
      ["getWorkspace", "ok"],
      ["listOrganizations", "ok"],
    ],
  );
  // Its owner reads what each call named and, when refused, why.
  const [decision, lookup, workspace] = calls;
  assert.deepEqual(decision!.detail?.target, {
    field: "sessionId",
    id: "session-1",
  });
  assert.equal(decision!.detail?.kind, "human_only");
  assert.match(decision!.detail?.message ?? "", /person/);
  assert.deepEqual(lookup!.detail?.target, { field: "key", id: "NOPE-1" });
  assert.ok(lookup!.detail?.message);
  assert.equal(workspace!.detail, null);
  await refused(
    invoke(web(memberId), "listAgentActivity", {
      organizationId,
      agentId: scout.id,
    }),
    "forbidden",
  );
  // Agents do not read activity records, their own included.
  await refused(
    invoke(agent, "listAgentActivity", { organizationId, agentId: scout.id }),
    "forbidden",
  );
});

void test("an agent acts with its owner's permissions narrowed by its scope", async () => {
  const ownerId = await user("Ada");
  const memberId = await user("Grace");
  const organizationId = await organization(ownerId, [memberId]);
  const pay = await project(ownerId, organizationId, "PAY");
  const ops = await project(ownerId, organizationId, "OPS");
  const typeId = await storyType(ownerId, organizationId);
  const opsItem = await workItem(web(ownerId), organizationId, ops, typeId);

  // Limited to PAY: works there, refused in OPS and organization-wide.
  const limited = await createAgent(ownerId, organizationId, {
    projectIds: [pay],
  });
  const forge = context(
    await agentPrincipal(ownerId, organizationId, limited.id),
  );
  const payItem = await workItem(forge, organizationId, pay, typeId);
  assert.ok(payItem);
  await refused(
    workItem(forge, organizationId, ops, typeId),
    "forbidden",
    "agent_scope",
  );
  await refused(
    invoke(forge, "getWorkItem", { organizationId, workItemId: opsItem }),
    "forbidden",
    "agent_scope",
  );
  await refused(
    invoke(forge, "searchMembers", { organizationId, q: "a" }),
    "forbidden",
    "agent_scope",
  );
  await invoke(forge, "getWorkItem", { organizationId, workItemId: payItem });
  // The change is attributed to the owner, via the agent.
  const [activity] = await db
    .select()
    .from(s.activity)
    .where(eq(s.activity.workItemId, payItem));
  assert.equal(activity!.actorId, ownerId);
  assert.equal(activity!.detail!.agentId, limited.id);
  assert.equal(activity!.detail!.agentHandle, limited.handle);

  // A read agent only reaches queries.
  const reader = await createAgent(ownerId, organizationId, { access: "read" });
  const readCtx = context(
    await agentPrincipal(ownerId, organizationId, reader.id),
  );
  await refused(workItem(readCtx, organizationId, pay, typeId), "forbidden");

  // Never more than the owner: a member's agent cannot do what the member
  // cannot (administer work item types).
  const memberAgent = await createAgent(memberId, organizationId);
  const memberCtx = context(
    await agentPrincipal(memberId, organizationId, memberAgent.id),
  );
  await refused(
    invoke(memberCtx, "createType", {
      organizationId,
      name: "Spike",
      icon: "task",
      color: "gray",
      level: 1,
      hasSpecification: false,
    }),
    "forbidden",
  );

  // Only in its own organization, even where its owner is also a member.
  const elsewhere = await organization(ownerId);
  const everywhere = await createAgent(ownerId, organizationId);
  const anywhere = context(
    await agentPrincipal(ownerId, organizationId, everywhere.id),
  );
  await refused(
    invoke(anywhere, "getWorkspace", { organizationId: elsewhere }),
    "forbidden",
    "agent_scope",
  );
  const { organizations } = (await invoke(
    anywhere,
    "listOrganizations",
    {},
  )) as {
    organizations: { id: string }[];
  };
  assert.deepEqual(
    organizations.map((o) => o.id),
    [organizationId],
  );

  // Archiving the agent stops its tokens; restoring brings them back.
  const { secret } = (await invoke(web(ownerId), "createAgentToken", {
    organizationId,
    agentId: everywhere.id,
    expiresInDays: null,
  })) as { secret: string };
  assert.ok(await authenticateAccessToken(db, secret));
  const archive = (archived: boolean) =>
    invoke(web(ownerId), "setAgentArchived", {
      organizationId,
      agentId: everywhere.id,
      archived,
    });
  await archive(true);
  assert.equal(await authenticateAccessToken(db, secret), null);
  await refused(start(ownerId, organizationId, everywhere.id), "conflict");
  await archive(false);
  assert.equal(
    (await authenticateAccessToken(db, secret))?.agent?.id,
    everywhere.id,
  );
  // Agent tokens are not listed among the owner's personal tokens.
  const { tokens } = (await invoke(web(ownerId), "listAccessTokens", {})) as {
    tokens: { id: string }[];
  };
  assert.equal(tokens.length, 0);
});

void test("agent management stays with people, and handles resolve for mentions", async () => {
  const ownerId = await user("Ada", `ada_${crypto.randomUUID().slice(0, 6)}`);
  const memberId = await user("Grace");
  const organizationId = await organization(ownerId, [memberId]);
  const forge = await createAgent(ownerId, organizationId, { handle: "forge" });
  const principal = await agentPrincipal(ownerId, organizationId, forge.id);
  for (const name of [
    "createAgent",
    "createAgentToken",
    "createRunnerRegistration",
  ])
    await refused(
      invoke(context(principal), name, { organizationId }),
      "forbidden",
      "human_only",
    );
  // Only the owner changes the agent.
  await refused(
    invoke(web(memberId), "updateAgent", {
      organizationId,
      agentId: forge.id,
      name: "Hammer",
    }),
    "forbidden",
  );
  // Handles are unique in the organization and never a member's.
  await refused(
    createAgent(memberId, organizationId, { handle: "forge" }),
    "validation",
  );
  const [owner] = await db
    .select({ handle: s.user.handle })
    .from(s.user)
    .where(eq(s.user.id, ownerId));
  await refused(
    createAgent(memberId, organizationId, { handle: owner!.handle! }),
    "validation",
  );
  const resolved = await resolveAgentHandle(db, organizationId, "@Forge");
  assert.equal(resolved?.id, forge.id);
  assert.equal(resolved?.ownerId, ownerId);
  assert.equal(await resolveAgentHandle(db, organizationId, "nobody"), null);
  const other = await organization(memberId);
  assert.equal(await resolveAgentHandle(db, other, "forge"), null);
});

void test("registration tokens are single use, expire and respect who may add runners", async () => {
  const ownerId = await user("Ada");
  const memberId = await user("Grace");
  const organizationId = await organization(ownerId, [memberId]);
  // Members add personal runners only.
  await refused(
    invoke(web(memberId), "createRunnerRegistration", {
      organizationId,
      personal: false,
    }),
    "forbidden",
  );
  const { token } = (await invoke(web(ownerId), "createRunnerRegistration", {
    organizationId,
    personal: false,
  })) as { token: string };
  const first = await registerRunner(db, {
    ...machine,
    token,
    name: "build-1",
  });
  assert.equal(first.personal, false);
  assert.ok(first.credential.startsWith("lcr_"));
  // Each refusal says whether to retype the token or create a new one.
  await assert.rejects(
    registerRunner(db, { ...machine, token, name: "again" }),
    /already used/,
  );
  await assert.rejects(
    registerRunner(db, { ...machine, token: `${token}x`, name: "typo" }),
    /issued no such registration token/,
  );
  // Expired after an hour.
  const { token: late } = (await invoke(
    web(memberId),
    "createRunnerRegistration",
    {
      organizationId,
      personal: true,
    },
  )) as { token: string };
  await refused(
    registerRunner(
      db,
      { ...machine, token: late, name: "late" },
      new Date(Date.now() + 61 * 60_000),
    ),
    "forbidden",
  );
  await assert.rejects(
    registerRunner(
      db,
      { ...machine, token: late, name: "late" },
      new Date(Date.now() + 61 * 60_000),
    ),
    /expired/,
  );
  // Credentials are stored hashed and stop working once revoked.
  const [row] = await db
    .select()
    .from(s.runner)
    .where(eq(s.runner.id, first.runnerId));
  assert.notEqual(row!.credentialHash, first.credential);
  assert.ok(await authenticateRunner(db, first.credential));
  await refused(
    invoke(web(memberId), "revokeRunner", {
      organizationId,
      runnerId: row!.id,
    }),
    "forbidden",
  );
  await invoke(web(ownerId), "revokeRunner", {
    organizationId,
    runnerId: row!.id,
  });
  assert.equal(await authenticateRunner(db, first.credential), null);
  // Projections carry no credential.
  const projections = await db
    .select()
    .from(s.factoryEntity)
    .where(eq(s.factoryEntity.organizationId, organizationId));
  assert.ok(projections.length > 0);
  assert.ok(!JSON.stringify(projections).includes(first.credential));
  assert.ok(!JSON.stringify(projections).includes(row!.credentialHash));
});

void test("a personal runner only runs its owner's agents", async () => {
  const ownerId = await user("Ada");
  const memberId = await user("Grace");
  const organizationId = await organization(ownerId, [memberId]);
  const adaAgent = await createAgent(ownerId, organizationId, { shared: true });
  const graceRunner = await runner(memberId, organizationId, true);
  // Grace may start a session with Ada's shared agent, but her laptop will
  // not run it: it would act as Ada on Grace's machine.
  const session = await start(memberId, organizationId, adaAgent.id);
  assert.equal(await claimSession(db, graceRunner), null);
  await refused(
    start(memberId, organizationId, adaAgent.id, { runnerId: graceRunner.id }),
    "forbidden",
  );
  const graceAgent = await createAgent(memberId, organizationId);
  const own = await start(memberId, organizationId, graceAgent.id);
  const claimed = await claimSession(db, graceRunner);
  assert.equal(claimed?.sessionId, own.id);
  // An organization runner runs any agent.
  const shared = await runner(ownerId, organizationId, false);
  assert.equal((await claimSession(db, shared))?.sessionId, session.id);
  // A private agent is started only by its owner.
  const privateAgent = await createAgent(ownerId, organizationId);
  await refused(start(memberId, organizationId, privateAgent.id), "forbidden");
});

void test("a runner's last problem reaches its page through the heartbeat; an older runner's silence keeps it", async () => {
  const ownerId = await user("Ada");
  const organizationId = await organization(ownerId);
  const registered = await runner(ownerId, organizationId, false);
  const projected = async () => {
    const [entity] = await db
      .select({ data: s.factoryEntity.data })
      .from(s.factoryEntity)
      .where(eq(s.factoryEntity.key, `runner:${registered.id}`));
    return (entity?.data as { lastError?: unknown } | undefined)?.lastError;
  };
  const row = async () =>
    (
      await db.select().from(s.runner).where(eq(s.runner.id, registered.id))
    )[0]!;
  assert.equal(await projected(), null);
  // The runner met a problem and reports it, with when, once it reaches the
  // server again.
  const problem = {
    message: "Asking for work failed: Could not connect to the server.",
    at: "2026-11-27T10:00:00.000Z",
  };
  await heartbeat(db, registered, {
    ...machine,
    sessions: [],
    lastError: problem,
  });
  assert.deepEqual(await projected(), problem);
  // A runner older than the field sends none: what it reported stays.
  await heartbeat(db, await row(), { ...machine, sessions: [] });
  assert.deepEqual(await projected(), problem);
  // A restarted runner that met no problem clears it.
  await heartbeat(db, await row(), {
    ...machine,
    sessions: [],
    lastError: null,
  });
  assert.equal(await projected(), null);
});

void test("leases fence every runner write and expired sessions return to the queue", async () => {
  const ownerId = await user("Ada");
  const organizationId = await organization(ownerId);
  const agent = await createAgent(ownerId, organizationId);
  const first = await runner(ownerId, organizationId, false);
  const second = await runner(ownerId, organizationId, false);
  const session = await start(ownerId, organizationId, agent.id, {
    repositoryUrl: "https://example.test/acme/payments.git",
  });
  const lease = (await claimSession(db, first))!;
  assert.equal(lease.attempt, 1);
  assert.equal(lease.repository?.branch.startsWith("lictory/"), true);
  // The runner's log links to the session's page.
  assert.ok(
    lease.sessionUrl?.endsWith(
      `/${organizationId}/factory/sessions/${session.id}`,
    ),
  );
  // Nobody else can claim it or write with another lease.
  assert.equal(await claimSession(db, second), null);
  await refused(
    appendRunnerEvents(db, second, session.id, lease.leaseToken, [event(1)]),
    "conflict",
    "lease_lost",
  );
  await startRun(db, first, session.id, lease.leaseToken);
  await appendRunnerEvents(db, first, session.id, lease.leaseToken, [event(1)]);

  // The runner disappears: its lease expires and the session is requeued.
  const later = new Date(Date.now() + 120_000);
  assert.deepEqual(
    await recoverExpiredSessions(db, { now: later, organizationId }),
    {
      requeued: 1,
      failed: 0,
    },
  );
  assert.equal((await sessionRow(session.id)).status, "queued");
  const retake = (await claimSession(db, second, later))!;
  assert.equal(retake.sessionId, session.id);
  assert.equal(retake.attempt, 2);
  assert.notEqual(retake.leaseToken, lease.leaseToken);
  // The old runner's late writes fail: the newer attempt wins.
  await refused(
    appendRunnerEvents(db, first, session.id, lease.leaseToken, [event(2)]),
    "conflict",
    "lease_lost",
  );
  await refused(
    completeRun(db, first, session.id, {
      leaseToken: lease.leaseToken,
      outcome: "completed",
      lastSeq: 1,
    }),
    "conflict",
    "lease_lost",
  );
  // A heartbeat renews leases it holds and reports the ones it lost.
  const beat = await heartbeat(db, first, {
    ...machine,
    sessions: [{ sessionId: session.id, leaseToken: lease.leaseToken }],
  });
  assert.equal(beat.leases[0]!.held, false);
  const kept = await heartbeat(db, second, {
    ...machine,
    sessions: [{ sessionId: session.id, leaseToken: retake.leaseToken }],
  });
  assert.equal(kept.leases[0]!.held, true);

  // After its last attempt the session fails instead.
  const muchLater = new Date(Date.now() + 10 * 60_000);
  await recoverExpiredSessions(db, { now: muchLater, organizationId });
  const third = (await claimSession(db, first, muchLater))!;
  assert.equal(third.attempt, 3);
  const end = new Date(Date.now() + 20 * 60_000);
  assert.deepEqual(
    await recoverExpiredSessions(db, { now: end, organizationId }),
    {
      requeued: 0,
      failed: 1,
    },
  );
  const failed = await sessionRow(session.id);
  assert.equal(failed.status, "failed");
  assert.match(failed.error!, /stopped responding 3 times/);
  // The session token died with the run.
  const live = await db
    .select()
    .from(s.accessToken)
    .where(eq(s.accessToken.agentSessionId, session.id));
  assert.ok(live.every((t) => t.revokedAt));
});

void test("event batches are idempotent by sequence, bounded and gap-checked", async () => {
  const ownerId = await user("Ada");
  const organizationId = await organization(ownerId);
  const agent = await createAgent(ownerId, organizationId);
  const machineRow = await runner(ownerId, organizationId, false);
  const session = await start(ownerId, organizationId, agent.id);
  const lease = (await claimSession(db, machineRow))!;
  await startRun(db, machineRow, session.id, lease.leaseToken);
  const before = (await eventsOf(session.id)).length;
  const batch = [event(1), event(2), event(3, "x".repeat(20_000))];
  const firstAck = await appendRunnerEvents(
    db,
    machineRow,
    session.id,
    lease.leaseToken,
    batch,
  );
  assert.equal(firstAck.acked, 3);
  // The same batch again (a retry after a lost response) adds nothing.
  const again = await appendRunnerEvents(
    db,
    machineRow,
    session.id,
    lease.leaseToken,
    batch,
  );
  assert.equal(again.acked, 3);
  const stored = await eventsOf(session.id);
  assert.equal(stored.length, before + 3);
  // Long payloads are cut.
  assert.ok(JSON.stringify(stored.at(-1)!.data).length < 17_000);
  // A gap is refused with what the server has.
  await assert.rejects(
    appendRunnerEvents(db, machineRow, session.id, lease.leaseToken, [
      event(5),
    ]),
    (error: unknown) => error instanceof SequenceGap && error.acked === 3,
  );
  // Completion requires every event to have arrived.
  await assert.rejects(
    completeRun(db, machineRow, session.id, {
      leaseToken: lease.leaseToken,
      outcome: "completed",
      lastSeq: 4,
    }),
    (error: unknown) => error instanceof SequenceGap,
  );
  const done = await completeRun(db, machineRow, session.id, {
    leaseToken: lease.leaseToken,
    outcome: "completed",
    summary: "Added the refund endpoint.",
    lastSeq: 3,
  });
  assert.equal(done.status, "completed");
  assert.equal(done.resultSummary, "Added the refund endpoint.");
});

void test("a session with no repository that changed files ends with its work recorded as not kept", async () => {
  const ownerId = await user("Ada");
  const organizationId = await organization(ownerId);
  const agent = await createAgent(ownerId, organizationId);
  const machineRow = await runner(ownerId, organizationId, false);
  const fileChange = (seq: number, ...paths: string[]) => ({
    seq,
    type: "file_change",
    data: {
      changes: paths.map((path) => ({ path, kind: "modify", additions: 1 })),
    },
  });
  const run = async (
    fields: Record<string, unknown>,
    events: ReturnType<typeof fileChange>[],
  ) => {
    const session = await start(ownerId, organizationId, agent.id, fields);
    const lease = (await claimSession(db, machineRow))!;
    assert.equal(lease.sessionId, session.id);
    await startRun(db, machineRow, session.id, lease.leaseToken);
    if (events.length)
      await appendRunnerEvents(
        db,
        machineRow,
        session.id,
        lease.leaseToken,
        events,
      );
    return completeRun(db, machineRow, session.id, {
      leaseToken: lease.leaseToken,
      outcome: "completed",
      summary: "Added CHANGES.md.",
      lastSeq: events.length,
    });
  };
  // Two files, one changed twice: two files were discarded with the
  // scratch workspace, and the session says so wherever it is read.
  const scratch = await run({}, [
    fileChange(1, "CHANGES.md"),
    fileChange(2, "CHANGES.md", "docs/refunds.md"),
  ]);
  assert.equal(scratch.status, "completed");
  assert.equal(scratch.discardedFiles, 2);
  const [projected] = await db
    .select({ data: s.factoryEntity.data })
    .from(s.factoryEntity)
    .where(eq(s.factoryEntity.key, `session:${scratch.id}`));
  assert.equal(
    (projected!.data as { discardedFiles: number | null }).discardedFiles,
    2,
  );
  // The person who started it hears that the work was not kept, not the
  // agent's own summary.
  const finished = (
    await db
      .select({ notices: s.notificationEvent.notices })
      .from(s.notificationEvent)
      .where(eq(s.notificationEvent.organizationId, organizationId))
  )
    .flatMap((row) => row.notices)
    .find(
      (n) =>
        n.kind === "agent_session_finished" &&
        n.detail?.sessionId === scratch.id,
    );
  const told = describeNotification(
    { kind: "agent_session_finished", detail: finished!.detail ?? {} },
    "Ada",
  );
  assert.match(told.headline, /finished, work not kept/);
  assert.match(told.body ?? "", /The 2 files it changed were discarded/);
  // Nothing changed, or a repository kept it: no discarded work.
  assert.equal((await run({}, [])).discardedFiles, null);
  assert.equal(
    (
      await run({ repositoryUrl: "https://git.example.test/acme/pay.git" }, [
        fileChange(1, "CHANGES.md"),
      ])
    ).discardedFiles,
    null,
  );
});

void test("the session state machine refuses steps from the wrong state", async () => {
  const ownerId = await user("Ada");
  const organizationId = await organization(ownerId);
  const agent = await createAgent(ownerId, organizationId);
  const machineRow = await runner(ownerId, organizationId, false);
  const session = await start(ownerId, organizationId, agent.id);
  const ctx = web(ownerId);
  const ids = { organizationId, sessionId: session.id };
  // Not started yet: nothing to interrupt, nothing to retry.
  await refused(
    invoke(ctx, "interruptAgentSession", ids),
    "conflict",
    "invalid_state",
  );
  await refused(
    invoke(ctx, "retryAgentSession", ids),
    "conflict",
    "invalid_state",
  );
  // Messages wait in the inbox until the agent starts.
  await invoke(ctx, "sendAgentSessionMessage", {
    ...ids,
    text: "Use the v2 API.",
  });
  const lease = (await claimSession(db, machineRow))!;
  const inbox = await readInputs(
    db,
    machineRow,
    session.id,
    lease.leaseToken,
    lease.inputCursor,
  );
  assert.deepEqual(
    inbox.inputs.map((i) => [i.kind, i.data.text]),
    [["message", "Use the v2 API."]],
  );
  await startRun(db, machineRow, session.id, lease.leaseToken);
  await invoke(ctx, "interruptAgentSession", ids);
  await completeRun(db, machineRow, session.id, {
    leaseToken: lease.leaseToken,
    outcome: "completed",
    lastSeq: 0,
  });
  await refused(
    invoke(ctx, "sendAgentSessionMessage", { ...ids, text: "One more thing" }),
    "conflict",
    "invalid_state",
  );
  await refused(
    invoke(ctx, "cancelAgentSession", ids),
    "conflict",
    "invalid_state",
  );
  await refused(
    invoke(ctx, "retryAgentSession", ids),
    "conflict",
    "invalid_state",
  );

  // Cancel is immediate: the runner's lease ends and its writes fail.
  const second = await start(ownerId, organizationId, agent.id);
  const secondLease = (await claimSession(db, machineRow))!;
  await startRun(db, machineRow, second.id, secondLease.leaseToken);
  await invoke(ctx, "cancelAgentSession", {
    organizationId,
    sessionId: second.id,
  });
  // Canceling again changes nothing.
  await invoke(ctx, "cancelAgentSession", {
    organizationId,
    sessionId: second.id,
  });
  await refused(
    appendRunnerEvents(db, machineRow, second.id, secondLease.leaseToken, [
      event(1),
    ]),
    "conflict",
    "lease_lost",
  );
  // A retry starts over and does not replay the old run's cancel.
  await invoke(ctx, "retryAgentSession", {
    organizationId,
    sessionId: second.id,
  });
  const retry = (await claimSession(db, machineRow))!;
  assert.equal(retry.sessionId, second.id);
  const inputs = await readInputs(
    db,
    machineRow,
    second.id,
    retry.leaseToken,
    retry.inputCursor,
  );
  assert.equal(inputs.inputs.length, 0);
});

void test("an agent waiting for a person's next message waits on them, and a retry sends the earlier messages again", async () => {
  const ownerId = await user("Ada");
  const organizationId = await organization(ownerId);
  const agent = await createAgent(ownerId, organizationId);
  const machineRow = await runner(ownerId, organizationId, false);
  const published: SessionThreadEvent[] = [];
  setSessionThreadPublisher({
    publish: async (e) => {
      published.push(e);
    },
  });
  const session = await start(ownerId, organizationId, agent.id);
  const ctx = web(ownerId);
  const ids = { organizationId, sessionId: session.id };
  const lease = (await claimSession(db, machineRow))!;
  await startRun(db, machineRow, session.id, lease.leaseToken);
  // The agent asks in its own words and its harness waits for an answer:
  // the session waits on the person, like an approval request.
  await appendRunnerEvents(db, machineRow, session.id, lease.leaseToken, [
    event(1, "Should I quarantine the test or fix the timeout?"),
    {
      seq: 2,
      type: "status",
      data: {
        phase: "awaiting_message",
        message: "Waiting for the next message.",
      },
    },
  ]);
  assert.equal((await sessionRow(session.id)).status, "waiting");
  assert.ok(
    published.some((e) => e.kind === "status" && e.sessionId === session.id),
    "the card and the claim hear that it waits",
  );
  // The person answers; the harness works again.
  await invoke(ctx, "sendAgentSessionMessage", {
    ...ids,
    text: "Fix the timeout.",
  });
  await appendRunnerEvents(db, machineRow, session.id, lease.leaseToken, [
    { seq: 3, type: "status", data: { phase: "working" } },
    event(4, "Got it: Fix the timeout."),
  ]);
  assert.equal((await sessionRow(session.id)).status, "running");
  // Interrupt says what it does: the turn stops and the agent waits.
  await invoke(ctx, "interruptAgentSession", ids);
  assert.ok(
    (await eventsOf(session.id)).some((e) =>
      String((e.data as { message?: string }).message).includes(
        "stops its current turn and waits for the next message",
      ),
    ),
  );
  // An approval request still pending keeps it waiting, whatever the
  // harness reports about messages.
  await appendRunnerEvents(db, machineRow, session.id, lease.leaseToken, [
    {
      seq: 5,
      type: "approval_request",
      data: {
        requestId: "tool-1",
        title: "Run the migration",
        tool: "Bash",
        input: { command: "bun run db:migrate" },
      },
    },
    { seq: 6, type: "status", data: { phase: "working" } },
  ]);
  assert.equal((await sessionRow(session.id)).status, "waiting");
  // Waiting on a person, it is not working: there is no turn to interrupt.
  await refused(
    invoke(ctx, "interruptAgentSession", ids),
    "conflict",
    "invalid_state",
  );
  await invoke(ctx, "cancelAgentSession", ids);
  // A retry starts over from the task with the person's messages, in
  // order, and without the old run's interrupt, cancel or answers.
  await invoke(ctx, "retryAgentSession", ids);
  const retried = await eventsOf(session.id);
  assert.match(
    String((retried.at(-1)?.data as { message?: string }).message),
    /starts over from the task with the message sent to it before\. Sent again: “Fix the timeout\.”$/,
  );
  const again = (await claimSession(db, machineRow))!;
  const inbox = await readInputs(
    db,
    machineRow,
    session.id,
    again.leaseToken,
    again.inputCursor,
  );
  assert.deepEqual(
    inbox.inputs.map((i) => [i.kind, i.data.text]),
    [["message", "Fix the timeout."]],
  );
  // A second retry sends each message once.
  await invoke(ctx, "cancelAgentSession", ids);
  await invoke(ctx, "retryAgentSession", ids);
  const third = (await claimSession(db, machineRow))!;
  const thirdInbox = await readInputs(
    db,
    machineRow,
    session.id,
    third.leaseToken,
    third.inputCursor,
  );
  assert.deepEqual(
    thirdInbox.inputs.map((i) => i.data.text),
    ["Fix the timeout."],
  );
  setSessionThreadPublisher(null);
});

void test("approval requests are answered only by the requester or the agent's owner", async () => {
  const ownerId = await user("Ada");
  const memberId = await user("Grace");
  const otherId = await user("Linus");
  const organizationId = await organization(ownerId, [memberId, otherId]);
  const agent = await createAgent(ownerId, organizationId, { shared: true });
  const machineRow = await runner(ownerId, organizationId, false);
  const published: SessionThreadEvent[] = [];
  setSessionThreadPublisher({
    publish: async (e) => {
      published.push(e);
    },
  });
  // The session's steering thread: a message in a channel Grace posts in.
  const channelId = crypto.randomUUID();
  await executeMutation(
    db,
    { userId: memberId },
    {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command: {
        type: "createChannel",
        channelId,
        kind: "public",
        name: `agents-${channelId.slice(0, 6)}`,
      },
    },
  );
  const { message: root } = await db.transaction((tx) =>
    postMessage(
      tx,
      { userId: memberId },
      { organizationId, channelId, body: "Can someone publish 2.1?" },
    ),
  );
  // Starting a session in a thread needs a channel the person posts in.
  await refused(
    start(otherId, organizationId, agent.id, {
      channelId,
      threadRootMessageId: root.id,
    }),
    "forbidden",
  );
  const session = await start(memberId, organizationId, agent.id, {
    channelId,
    threadRootMessageId: root.id,
  });
  const lease = (await claimSession(db, machineRow))!;
  await startRun(db, machineRow, session.id, lease.leaseToken);
  await appendRunnerEvents(db, machineRow, session.id, lease.leaseToken, [
    {
      seq: 1,
      type: "approval_request",
      data: {
        requestId: "tool-1",
        title: "Run `npm publish`",
        tool: "Bash",
        input: { command: "npm publish" },
      },
    },
  ]);
  const waiting = await sessionRow(session.id);
  assert.equal(waiting.status, "waiting");
  // The requester and the agent's owner are asked, through the queue.
  const queued = await db
    .select()
    .from(s.notificationEvent)
    .where(eq(s.notificationEvent.organizationId, organizationId));
  const asked = queued
    .flatMap((e) => e.notices)
    .find((n) => n.kind === "agent_approval_requested");
  assert.deepEqual(new Set(asked?.userIds), new Set([memberId, ownerId]));
  assert.equal(asked?.detail?.sessionId, session.id);
  assert.ok(
    published.some(
      (e) => e.kind === "approval_requested" && e.channelId === channelId,
    ),
  );
  const [approval] = await db
    .select()
    .from(s.agentApproval)
    .where(eq(s.agentApproval.sessionId, session.id));
  const answer = (ctx: CapabilityContext, decision = "deny") =>
    invoke(ctx, "answerAgentApproval", {
      organizationId,
      sessionId: session.id,
      approvalId: approval!.id,
      decision,
    });
  // Another member cannot decide, and neither can the agent itself: the
  // server refuses a person's decision to every agent (human_only).
  await refused(answer(web(otherId)), "forbidden");
  await refused(
    answer(context(await agentPrincipal(ownerId, organizationId, agent.id))),
    "forbidden",
    "human_only",
  );
  // The session's own token is the agent too.
  const sessionToken = (await authenticateAccessToken(
    db,
    lease.lictory.token,
  ))!;
  assert.equal(sessionToken.agent?.sessionId, session.id);
  await refused(
    answer(
      context({
        userId: sessionToken.userId,
        surface: "mcp",
        agent: sessionToken.agent,
        tokenId: sessionToken.tokenId,
      }),
      "approve",
    ),
    "forbidden",
    "human_only",
  );
  // The requester decides; the session resumes and the runner hears it.
  await answer(web(memberId), "deny");
  assert.equal((await sessionRow(session.id)).status, "running");
  const inbox = await readInputs(
    db,
    machineRow,
    session.id,
    lease.leaseToken,
    0,
  );
  const answered = inbox.inputs.find((i) => i.kind === "approval_answer")!;
  assert.equal(answered.data.requestId, "tool-1");
  assert.equal(answered.data.decision, "deny");
  // Answering twice is refused by the approval's own machine.
  await refused(answer(web(ownerId), "approve"), "conflict", "invalid_state");
  // The session token stops working when the session ends.
  await completeRun(db, machineRow, session.id, {
    leaseToken: lease.leaseToken,
    outcome: "completed",
    lastSeq: 1,
  });
  assert.equal(await authenticateAccessToken(db, lease.lictory.token), null);
});

// Text is never permission: a request that names no action (no tool and
// input) is a question, which a person answers in words or denies.
void test("a request naming no action is a question: answered in words, never approved", async () => {
  const ownerId = await user("Ada");
  const organizationId = await organization(ownerId);
  const agent = await createAgent(ownerId, organizationId);
  const machineRow = await runner(ownerId, organizationId, false);
  const session = await start(ownerId, organizationId, agent.id);
  const lease = (await claimSession(db, machineRow))!;
  await startRun(db, machineRow, session.id, lease.leaseToken);
  await appendRunnerEvents(db, machineRow, session.id, lease.leaseToken, [
    {
      seq: 1,
      type: "approval_request",
      data: { requestId: "ask-1", title: "Run the migration on staging" },
    },
    {
      seq: 2,
      type: "approval_request",
      data: {
        requestId: "tool-2",
        title: "Run the migration",
        tool: "Bash",
        input: { command: "bun run db:migrate" },
      },
    },
  ]);
  assert.equal((await sessionRow(session.id)).status, "waiting");
  const approvals = await db
    .select()
    .from(s.agentApproval)
    .where(eq(s.agentApproval.sessionId, session.id));
  const question = approvals.find((a) => a.requestKey === "ask-1")!;
  const permission = approvals.find((a) => a.requestKey === "tool-2")!;
  const answer = (approvalId: string, decision: string, note?: string) =>
    invoke(web(ownerId), "answerAgentApproval", {
      organizationId,
      sessionId: session.id,
      approvalId,
      decision,
      ...(note === undefined ? {} : { note }),
    });
  // A title alone cannot be approved, and an answer needs words.
  await refused(answer(question.id, "approve"), "validation");
  await refused(answer(question.id, "answer", "  "), "validation");
  // A permission is approved or denied, not answered around.
  await refused(answer(permission.id, "answer", "Sure"), "validation");
  await answer(
    question.id,
    "answer",
    "Run it after 18:00 with --dry-run first.",
  );
  const [answered] = await db
    .select()
    .from(s.agentApproval)
    .where(eq(s.agentApproval.id, question.id));
  assert.equal(answered!.status, "answered");
  assert.equal(answered!.note, "Run it after 18:00 with --dry-run first.");
  // The permission still waits: the session waits until it is decided.
  assert.equal((await sessionRow(session.id)).status, "waiting");
  const inbox = await readInputs(
    db,
    machineRow,
    session.id,
    lease.leaseToken,
    0,
  );
  const heard = inbox.inputs.find((i) => i.kind === "approval_answer")!;
  assert.equal(heard.data.requestId, "ask-1");
  assert.equal(heard.data.decision, "answer");
  assert.equal(heard.data.note, "Run it after 18:00 with --dry-run first.");
  await answer(permission.id, "approve");
  assert.equal((await sessionRow(session.id)).status, "running");
});

void test("the model proxy serves only running built-in sessions with Lictory Intelligence on", async () => {
  const ownerId = await user("Ada");
  const organizationId = await organization(ownerId);
  const builtIn = await createAgent(ownerId, organizationId, {
    harness: "lictory",
  });
  const machineRow = await runner(ownerId, organizationId, false);
  const session = await start(ownerId, organizationId, builtIn.id);
  const lease = (await claimSession(db, machineRow))!;
  assert.equal(lease.modelProxy, false);
  // Not running yet.
  await refused(
    modelAccess(db, machineRow, session.id, lease.leaseToken),
    "conflict",
    "invalid_state",
  );
  await startRun(db, machineRow, session.id, lease.leaseToken);
  // No provider on this server.
  await refused(
    modelAccess(db, machineRow, session.id, lease.leaseToken),
    "unavailable",
  );
  // A provider, but the organization has not enabled Lictory Intelligence.
  process.env.OPENAI_API_KEY = "test-key-not-a-credential";
  try {
    await refused(
      modelAccess(db, machineRow, session.id, lease.leaseToken),
      "forbidden",
      "ai_disabled",
    );
    await invoke(web(ownerId), "setAiPolicy", {
      organizationId,
      enabled: true,
    });
    assert.deepEqual(
      await modelAccess(db, machineRow, session.id, lease.leaseToken),
      { organizationId, sessionId: session.id },
    );
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
  // The proxy streams the model's parts and keeps runner-chosen headers out.
  let seen: Record<string, unknown> | undefined;
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      seen = { ...options };
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-start", id: "t" });
            controller.enqueue({ type: "text-delta", id: "t", delta: "Done." });
            controller.enqueue({ type: "text-end", id: "t" });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            });
            controller.close();
          },
        }),
      };
    },
  });
  const stream = await proxyModelStream(
    {
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      headers: { authorization: "Bearer stolen" },
    },
    { model },
  );
  const lines = (await new Response(stream).text())
    .trim()
    .split("\n")
    .map((l) => decodeWire(JSON.parse(l)) as { type: string });
  assert.deepEqual(
    lines.map((l) => l.type),
    ["text-start", "text-delta", "text-end", "finish"],
  );
  assert.equal(seen?.headers, undefined);
  // Agents of other harnesses never use the proxy.
  const claude = await createAgent(ownerId, organizationId);
  const other = await start(ownerId, organizationId, claude.id);
  const otherLease = (await claimSession(db, machineRow))!;
  assert.equal(otherLease.sessionId, other.id);
  await startRun(db, machineRow, other.id, otherLease.leaseToken);
  process.env.OPENAI_API_KEY = "test-key-not-a-credential";
  try {
    await refused(
      modelAccess(db, machineRow, other.id, otherLease.leaseToken),
      "forbidden",
    );
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

void test("organizations are isolated: members, runners and agents of one never reach another", async () => {
  const adaId = await user("Ada");
  const linusId = await user("Linus");
  const northwind = await organization(adaId);
  const contoso = await organization(linusId);
  const agent = await createAgent(adaId, northwind);
  const session = await start(adaId, northwind, agent.id);
  // A member of another organization sees and steers nothing.
  await refused(
    invoke(web(linusId), "getAgentSession", {
      organizationId: northwind,
      sessionId: session.id,
    }),
    "forbidden",
  );
  await refused(
    invoke(web(linusId), "getAgentSession", {
      organizationId: contoso,
      sessionId: session.id,
    }),
    "not_found",
  );
  await refused(
    invoke(web(linusId), "startAgentSession", {
      organizationId: contoso,
      agentId: agent.id,
      prompt: "Do it",
    }),
    "not_found",
  );
  // Another organization's runner never claims it or writes to it.
  const foreign = await runner(linusId, contoso, false);
  assert.equal(await claimSession(db, foreign), null);
  const local = await runner(adaId, northwind, false);
  const lease = (await claimSession(db, local))!;
  await refused(
    appendRunnerEvents(db, foreign, session.id, lease.leaseToken, [event(1)]),
    "conflict",
    "lease_lost",
  );
  // Projections stay in their organization.
  const rows = await db
    .select()
    .from(s.factoryEntity)
    .where(
      and(
        eq(s.factoryEntity.organizationId, contoso),
        eq(s.factoryEntity.type, "session"),
      ),
    );
  assert.equal(rows.length, 0);
});

void test("session titles stored with a doubled mention read with one @, wherever they are shown", () => {
  assert.equal(
    sessionTitle("@@forge draft the refund webhook payload docs"),
    "@forge draft the refund webhook payload docs",
  );
  assert.equal(sessionTitle("ask @@forge and @@@hawk"), "ask @forge and @hawk");
  // An address and a plain title are left alone.
  assert.equal(sessionTitle("mail bo@@example.test"), "mail bo@@example.test");
  assert.equal(
    sessionTitle("PAY-6: Duplicate charge"),
    "PAY-6: Duplicate charge",
  );
  assert.equal(
    describeNotification(
      {
        kind: "agent_session_finished",
        detail: {
          agentName: "Forge",
          status: "completed",
          sessionTitle: "@@forge draft docs",
        },
      },
      "Ada",
    ).headline,
    "Forge finished: @forge draft docs",
  );
});

void test("a queued session waits for a runner when no online runner may take it", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  const seen = new Date(now - 30_000).toISOString();
  const agent = {
    kind: "runner" as const,
    harness: "claude-code" as const,
    ownerId: "ada",
    archivedAt: null,
  };
  const session = { status: "queued" as const, requestedRunnerId: null };
  const runner = (extra: Record<string, unknown> = {}) => ({
    id: "r1",
    lastSeenAt: seen,
    revokedAt: null,
    harnesses: [{ id: "claude-code", version: "2" }],
    ownerId: null,
    ...extra,
  });
  assert.equal(waitsForRunner(session, agent, [runner()], now), false);
  // Offline, without the harness, someone else's laptop, or not the
  // runner the session asked for: nobody takes it.
  for (const other of [
    runner({ lastSeenAt: new Date(now - 10 * 60_000).toISOString() }),
    runner({ harnesses: [{ id: "codex", version: "1" }] }),
    runner({ ownerId: "ben" }),
    runner({ revokedAt: seen }),
  ])
    assert.equal(waitsForRunner(session, agent, [other], now), true);
  assert.equal(
    waitsForRunner(
      { status: "queued", requestedRunnerId: "r2" },
      agent,
      [runner()],
      now,
    ),
    true,
  );
  // Its owner's own laptop runs it; a running session waits for nothing.
  assert.equal(
    waitsForRunner(session, agent, [runner({ ownerId: "ada" })], now),
    false,
  );
  assert.equal(
    waitsForRunner({ ...session, status: "running" }, agent, [], now),
    false,
  );
});
