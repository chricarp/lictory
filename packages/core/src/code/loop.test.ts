import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { seedOrganization } from "@lictory/core/domain/organization";
import { DomainError } from "@lictory/core/domain/errors";
import {
  directory,
  executeMutation,
  lock,
  type Actor,
} from "@lictory/core/domain/service";
import { authenticateAccessToken } from "@lictory/core/capabilities/access-tokens";
import {
  noEffects,
  type CapabilityContext,
  type Principal,
} from "@lictory/core/capabilities/core";
import { invoke } from "@lictory/core/capabilities/registry";
import { registerAgentDirectory } from "@lictory/core/channels/agents";
import { postMessage } from "@lictory/core/channels/writer";
import { claimPorts, resetClaimPorts } from "@lictory/core/claims/ports";
import { runDispatcher } from "@lictory/core/claims/dispatcher";
import { defaultAutonomyPolicy } from "@lictory/core/claims/contracts";
import {
  followDefinitionOfDone,
  setAutonomyPolicy,
  setDefinitionOfDone,
} from "@lictory/core/claims/service";
import {
  authenticateRunner,
  registerRunner,
  type RunnerRow,
} from "@lictory/core/factory/runners";
import {
  claimSession,
  completeRun,
  sessionWorkspace,
  startRun,
  startSession,
} from "@lictory/core/factory/sessions";
import {
  sessionPushed,
  setSessionCompletionListener,
  setSessionRepositoryNamer,
  setSessionLeaseListener,
  setSessionThreadPublisher,
  setSessionWorkspaceResolver,
  type SessionCompletion,
} from "@lictory/core/factory/ports";
import { installFactoryLoop } from "@lictory/core/factory/loop";
import { sessionCardId } from "@lictory/core/factory/thread-ids";
import type { AgentEntity } from "@lictory/core/factory/entities";
import {
  createFakeCodeHost,
  fakeCodeHosts,
} from "@lictory/core/code/fake-provider";
import { createCodeIngest, receiveWebhook } from "@lictory/core/code/ingest";
import { createCodeOutbox } from "@lictory/core/code/outbox";
import { setCodeSessionHooks } from "@lictory/core/code/hooks";
import { installCodeLoop } from "@lictory/core/code/loop";
import { createCodeEvidence } from "@lictory/core/code/ports";
import { codeProjectionDrift } from "@lictory/core/code/projections";
import { createCodeService } from "@lictory/core/code/service";
import type { CodePullRequestEntity } from "@lictory/core/code/entities";
import type { SessionCardPayload } from "@lictory/core/factory/session-cards";

// The code loop joined up (docs/internals/code-hosts.md#the-code-loop): a
// session's workspace is the item's repository with a credential for it,
// its pushed branch becomes one pull request linked to the item and the
// session, the reviewer agent reviews each head, the Definition of Done
// follows ingest, a person merges (Build) or Autopilot merges once per head
// under the policy's administrator, and nothing crosses organizations.

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_code_loop_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 8, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;
process.env.DELIVERY_CREDENTIALS_KEY = "code-loop-test-key";

// One host for every organization of this file (repositories are named per
// organization).
const host = createFakeCodeHost();
const providers = fakeCodeHosts(host);
const appUrl = "https://lictory.test";

before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
  installFactoryLoop(db);
  installCodeLoop(db, { providers, appUrl });
});
after(async () => {
  resetClaimPorts();
  registerAgentDirectory({
    agents: async () => [],
    search: async () => [],
    actingAgent: async () => null,
  });
  setSessionThreadPublisher(null);
  setSessionLeaseListener(null);
  setSessionWorkspaceResolver(null);
  setSessionCompletionListener(null);
  setSessionRepositoryNamer(null);
  setCodeSessionHooks(null);
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`;
  await admin.end();
});

const context = (principal: Principal): CapabilityContext => ({
  db,
  principal,
  effects: noEffects,
  codeHostProviders: providers,
});
const web = (userId: string) => context({ userId, surface: "web" });

const refusal =
  (category: DomainError["category"], pattern?: RegExp) => (error: unknown) =>
    error instanceof DomainError &&
    error.category === category &&
    (!pattern || pattern.test(error.message));

async function fixture() {
  const organizationId = crypto.randomUUID();
  const tag = organizationId.slice(0, 8);
  const [ada, bo, cy] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ] as [string, string, string];
  await db.insert(s.user).values(
    [
      [ada, "Ada Owner"],
      [bo, "Bo Engineer"],
      [cy, "Cy Member"],
    ].map(([id, name]) => ({
      id: id!,
      name: name!,
      email: `${id}@example.test`,
    })),
  );
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Factory",
    slug: `code-loop-${tag}`,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [ada, bo, cy].map((userId, index) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: index === 0 ? "owner" : "member",
      createdAt: new Date(),
    })),
  );
  await seedOrganization(db, organizationId);
  const run = (command: Command, actor: Actor | string = ada) =>
    executeMutation(db, typeof actor === "string" ? { userId: actor } : actor, {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command,
    });
  const projectId = crypto.randomUUID();
  const opsId = crypto.randomUUID();
  await run({ type: "createProject", projectId, name: "Payments", key: "PAY" });
  await run({
    type: "createProject",
    projectId: opsId,
    name: "Operations",
    key: "OPS",
  });
  const roster = await directory(db, ada, organizationId);
  const engineering = roster.disciplines.find(
    (d) => d.projectId === projectId && d.name === "Engineering",
  )!;
  await run({
    type: "setDisciplineMember",
    projectId,
    disciplineId: engineering.id,
    userId: bo,
    member: true,
  });
  const types = roster.types;

  // GitHub, with acme/pay-<tag> and acme/web-<tag> serving Payments and
  // acme/ops-<tag> serving Operations.
  const repos = {
    pay: host.addRepository(`acme/pay-${tag}`),
    web: host.addRepository(`acme/web-${tag}`),
    ops: host.addRepository(`acme/ops-${tag}`),
  };
  const service = createCodeService(db, { providers, appUrl });
  const connected = await service.connect(
    { userId: ada },
    {
      organizationId,
      provider: "github",
      authKind: "token",
      baseUrl: "https://github.com",
      credential: { token: "github_pat_loop" },
    },
  );
  const link = async (repository: string, project: string) =>
    (
      await service.linkRepository(
        { userId: ada },
        {
          organizationId,
          connectionId: connected.connectionId,
          repository,
          projectId: project,
        },
      )
    ).repositoryId;
  const repositoryIds = {
    pay: await link(repos.pay.fullName, projectId),
    web: await link(repos.web.fullName, projectId),
    ops: await link(repos.ops.fullName, opsId),
  };
  const ingest = createCodeIngest(db, { providers });
  const outbox = createCodeOutbox(db, { providers });
  const deliver = async (event: string, payload: Record<string, unknown>) => {
    const signed = host.webhook(connected.webhookSecret!, event, payload);
    await receiveWebhook(
      db,
      { connectionId: connected.connectionId, ...signed },
      { providers },
    );
    await ingest.processPending();
  };

  const agent = async (userId: string, name: string, handle: string) =>
    (
      (await invoke(web(userId), "createAgent", {
        organizationId,
        kind: "runner",
        name,
        handle: `${handle}_${tag.slice(0, 6)}`,
        harness: "claude-code",
        access: "write",
      })) as { agent: AgentEntity }
    ).agent;
  const forge = await agent(ada, "Forge", "forge");
  const hawk = await agent(bo, "Hawk", "hawk");
  const { token } = (await invoke(web(ada), "createRunnerRegistration", {
    organizationId,
    personal: false,
  })) as { token: string };
  const registered = await registerRunner(db, {
    os: "linux",
    arch: "x64",
    version: "0.1.0",
    hostname: "build-1",
    harnesses: [{ id: "claude-code", version: "2.1.0" }],
    maxSessions: 12,
    isolation: "host",
    token,
    name: "build-1",
  });
  const runner = (await authenticateRunner(db, registered.credential))!;
  const channelId = crypto.randomUUID();
  await run({
    type: "createChannel",
    channelId,
    kind: "public",
    name: `pay-${tag}`,
  });

  const task = async (title: string, project = projectId) => {
    const workItemId = crypto.randomUUID();
    await run({
      type: "createWorkItem",
      projectId: project,
      workItemId,
      typeId: types.find((t) => t.name === "Task")!.id,
      parentId: null,
      title,
    });
    return workItemId;
  };
  // A story agreed for delivery: approved by Engineering, scope accepted.
  const agreedStory = async (title: string) => {
    const workItemId = crypto.randomUUID();
    await run({
      type: "createWorkItem",
      projectId,
      workItemId,
      typeId: types.find((t) => t.name === "Story")!.id,
      parentId: null,
      title,
      description:
        "## Behavior\n\nRefunds reuse the original transaction ID.\n\n## Acceptance criteria\n\n- A retry never charges twice.",
    });
    const latest = async () =>
      (
        await db
          .select()
          .from(s.specificationRevision)
          .where(eq(s.specificationRevision.workItemId, workItemId))
          .orderBy(desc(s.specificationRevision.number))
          .limit(1)
      )[0]!;
    const reviewId = crypto.randomUUID();
    await run({
      type: "requestReview",
      workItemId,
      baseRevisionId: (await latest()).id,
      reviewId,
      disciplineId: engineering.id,
      userId: bo,
      required: true,
    });
    await run(
      {
        type: "decideReview",
        workItemId,
        baseRevisionId: (await latest()).id,
        reviewId,
        decision: "approve",
      },
      bo,
    );
    await run({
      type: "acceptDeliveryScope",
      workItemId,
      baseRevisionId: (await latest()).id,
    });
    return { workItemId, revisionId: (await latest()).id };
  };
  const policy = (level: "assist" | "build" | "autopilot", by: string = ada) =>
    setAutonomyPolicy(
      db,
      { userId: by },
      {
        organizationId,
        projectId,
        policy: {
          ...defaultAutonomyPolicy,
          level,
          implementerAgentIds: [forge.id],
          reviewerAgentId: hawk.id,
          reportingChannelId: channelId,
        },
      },
    );
  const sessions = () =>
    db
      .select()
      .from(s.agentSession)
      .where(eq(s.agentSession.organizationId, organizationId))
      .orderBy(asc(s.agentSession.createdAt));
  const session = async (id: string) =>
    (
      await db.select().from(s.agentSession).where(eq(s.agentSession.id, id))
    )[0]!;
  const pullRequests = () =>
    db
      .select()
      .from(s.codePullRequest)
      .where(eq(s.codePullRequest.organizationId, organizationId))
      .orderBy(asc(s.codePullRequest.number));
  const prEntity = async (id: string) =>
    (
      await db
        .select({ data: s.codeEntity.data })
        .from(s.codeEntity)
        .where(eq(s.codeEntity.key, `codePullRequest:${id}`))
    )[0]?.data as unknown as CodePullRequestEntity | undefined;
  const writes = () =>
    db
      .select()
      .from(s.codeWrite)
      .where(eq(s.codeWrite.organizationId, organizationId))
      .orderBy(asc(s.codeWrite.createdAt));
  const item = async (workItemId: string) =>
    (
      await db
        .select({
          category: s.workflowStatus.category,
          deliveredRevisionId: s.workItem.deliveredRevisionId,
        })
        .from(s.workItem)
        .innerJoin(
          s.workflowStatus,
          eq(s.workflowStatus.id, s.workItem.statusId),
        )
        .where(eq(s.workItem.id, workItemId))
    )[0]!;
  const doneChecks = async (workItemId: string) =>
    (
      (
        await db
          .select({ data: s.syncEntity.data })
          .from(s.syncEntity)
          .where(eq(s.syncEntity.key, `doneEvaluation:${workItemId}`))
      )[0]?.data as
        | {
            passed: boolean;
            checks: { kind: string; passed: boolean; detail: string }[];
          }
        | undefined
    )?.checks ?? [];
  const passing = async (workItemId: string, kind: string) =>
    (await doneChecks(workItemId)).find((c) => c.kind === kind)?.passed ??
    false;
  // CI on the host reports `state` for a commit and the webhook says so.
  const ci = async (
    repo: { externalId: string },
    number: number,
    sha: string,
    state: "success" | "failure" | "pending",
  ) => {
    host.setChecks(repo.externalId, sha, [{ name: "ci", state, url: null }]);
    await deliver("check_suite", {
      repository: host.repositoryPayload(repo.externalId),
      check_suite: { head_sha: sha, pull_requests: [{ number }] },
    });
  };
  return {
    organizationId,
    projectId,
    opsId,
    ada,
    bo,
    cy,
    run,
    repos,
    repositoryIds,
    service,
    outbox,
    deliver,
    forge,
    hawk,
    agent,
    runner,
    channelId,
    task,
    agreedStory,
    policy,
    sessions,
    session,
    pullRequests,
    prEntity,
    writes,
    item,
    doneChecks,
    passing,
    ci,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

// The runner claims the next session and starts it; returns its lease and
// the session's own token as an MCP principal.
async function claimAndStart(runner: RunnerRow, agentId?: string) {
  let assignment = (await claimSession(db, runner))!;
  assert.ok(assignment, "the runner claims a session");
  // Sessions of other agents (a reviewer's for an older head) stay with
  // the runner, unstarted.
  for (let i = 0; agentId && assignment.agent.id !== agentId && i < 5; i++)
    assignment = (await claimSession(db, runner))!;
  if (agentId) assert.equal(assignment.agent.id, agentId);
  await startRun(db, runner, assignment.sessionId, assignment.leaseToken);
  const token = (await authenticateAccessToken(db, assignment.lictory.token))!;
  const principal: Principal = {
    userId: token.userId,
    surface: "mcp",
    tokenId: token.tokenId,
    agentName: token.name,
    agent: token.agent,
    access: token.access,
  };
  return { assignment, principal };
}

// The runner claims the next session, prepares its workspace, "pushes" the
// branch on the host and completes: the branch becomes a pull request.
async function implement(f: Fixture, repo: { externalId: string }) {
  const { assignment } = await claimAndStart(f.runner, f.forge.id);
  const { repository } = await sessionWorkspace(
    db,
    f.runner,
    assignment.sessionId,
    assignment.leaseToken,
  );
  assert.ok(repository, "the session works in a repository");
  host.pushBranch(repo.externalId, repository.branch);
  await completeRun(db, f.runner, assignment.sessionId, {
    leaseToken: assignment.leaseToken,
    outcome: "completed",
    summary: "Refunds reuse the original transaction id.",
    branch: repository.branch,
    lastSeq: 0,
  });
  await f.outbox.processDue();
  return { sessionId: assignment.sessionId, branch: repository.branch };
}

void test("the workspace is the session's repository, else the project's default, else its first, with a credential for it", async () => {
  const f = await fixture();
  const item = await f.task("Refunds over the API");
  const start = (input: { repositoryId?: string; agentId?: string } = {}) =>
    startSession(
      db,
      { userId: input.agentId === f.hawk.id ? f.bo : f.ada },
      {
        organizationId: f.organizationId,
        agentId: input.agentId ?? f.forge.id,
        prompt: "Implement the refund endpoint.",
        workItemId: item,
        repositoryId: input.repositoryId,
      },
    );
  const workspace = async () => {
    const { assignment } = await claimAndStart(f.runner);
    return {
      sessionId: assignment.sessionId,
      ...(await sessionWorkspace(
        db,
        f.runner,
        assignment.sessionId,
        assignment.leaseToken,
      )),
    };
  };

  // No default: the first repository linked to Payments.
  const first = await start();
  const a = await workspace();
  assert.equal(a.sessionId, first.id);
  assert.equal(
    a.repository?.url,
    `https://github.example/${f.repos.pay.fullName}.git`,
  );
  assert.equal(a.repository?.baseBranch, "main");
  // The branch is named for the item (key and title) and the session.
  assert.match(
    a.repository.branch,
    /^lictory\/pay-1-refunds-over-the-api-[0-9a-f]{8}$/,
  );
  // The credential is brokered for git over HTTPS; the connection's token
  // is a stored one here (GitHub Apps mint one per session).
  assert.deepEqual(a.repository?.auth, {
    username: "x-access-token",
    password: "github_pat_loop",
    expiresAt: null,
  });
  // The choice is recorded on the session, for its pull request.
  assert.equal((await f.session(first.id)).repositoryId, f.repositoryIds.pay);

  // A project administrator chooses acme/web as the default.
  await assert.rejects(
    invoke(web(f.bo), "setDefaultCodeRepository", {
      organizationId: f.organizationId,
      projectId: f.projectId,
      repositoryId: f.repositoryIds.web,
    }),
    (error: Error) => error.message.includes("administrators"),
  );
  await invoke(web(f.ada), "setDefaultCodeRepository", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    repositoryId: f.repositoryIds.web,
  });
  await start();
  assert.equal(
    (await workspace()).repository?.url,
    `https://github.example/${f.repos.web.fullName}.git`,
  );
  // A session that names a repository works there.
  await start({ repositoryId: f.repositoryIds.pay });
  assert.equal(
    (await workspace()).repository?.url,
    `https://github.example/${f.repos.pay.fullName}.git`,
  );
  // A repository that does not serve the item's project is refused.
  await start({ repositoryId: f.repositoryIds.ops });
  await assert.rejects(workspace(), refusal("validation", /does not serve/));
  // The agent's owner must be able to work with the code: Cy's agent
  // (no "Change properties" in Payments) gets no credential.
  const scout = await f.agent(f.cy, "Scout", "scout");
  await startSession(
    db,
    { userId: f.cy },
    {
      organizationId: f.organizationId,
      agentId: scout.id,
      prompt: "Look around.",
      workItemId: item,
    },
  );
  await assert.rejects(workspace(), refusal("forbidden", /cannot work/));
  // The projection says which repository is the default.
  const [row] = await db
    .select({ data: s.codeEntity.data })
    .from(s.codeEntity)
    .where(eq(s.codeEntity.key, `codeRepository:${f.repositoryIds.web}`));
  assert.deepEqual(
    (row!.data as { defaultForProjectIds: string[] }).defaultForProjectIds,
    [f.projectId],
  );
});

void test("a pushed branch becomes one pull request, linked to the item and the session, however often completion is reported", async () => {
  const f = await fixture();
  const item = await f.task("Refunds over the API");
  const started = await startSession(
    db,
    { userId: f.ada },
    {
      organizationId: f.organizationId,
      agentId: f.forge.id,
      prompt: "Implement the refund endpoint.",
      workItemId: item,
      channelId: f.channelId,
    },
  );
  const { assignment } = await claimAndStart(f.runner);
  const { repository } = await sessionWorkspace(
    db,
    f.runner,
    assignment.sessionId,
    assignment.leaseToken,
  );
  host.pushBranch(f.repos.pay.externalId, repository!.branch);
  await completeRun(db, f.runner, started.id, {
    leaseToken: assignment.leaseToken,
    outcome: "completed",
    summary: "Refunds reuse the original transaction id.",
    branch: repository!.branch,
    lastSeq: 0,
  });
  // The completion hook runs again (a retried call, a second worker): the
  // same write is reused.
  const row = await f.session(started.id);
  const completion: SessionCompletion = {
    organizationId: f.organizationId,
    sessionId: row.id,
    agentId: f.forge.id,
    ownerId: f.ada,
    agentName: "Forge",
    agentHandle: f.forge.handle,
    requestedById: f.ada,
    projectId: f.projectId,
    workItemId: item,
    repositoryId: row.repositoryId,
    repositoryUrl: null,
    baseBranch: null,
    branch: repository!.branch,
    title: row.title,
    summary: row.resultSummary,
    attempt: row.attempts,
  };
  await sessionPushed(completion);
  const queued = (await f.writes()).filter(
    (w) => w.kind === "open_pull_request",
  );
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.agentSessionId, started.id);
  assert.equal(queued[0]!.agentId, f.forge.id);
  assert.equal(queued[0]!.requestedById, f.ada);
  await f.outbox.processDue();
  // A later attempt of the session (a retry) finds the open pull request
  // by its head branch instead of opening another.
  await sessionPushed({ ...completion, attempt: completion.attempt + 1 });
  await f.outbox.processDue();
  const prs = await f.pullRequests();
  assert.equal(prs.length, 1);
  const [pr] = prs;
  assert.equal(pr!.headBranch, repository!.branch);
  assert.equal(pr!.agentSessionId, started.id);
  assert.equal(pr!.agentId, f.forge.id);
  assert.equal(pr!.openedById, f.ada);
  assert.equal(pr!.openedVia, "Forge");
  assert.match(pr!.title, /^PAY-1: Refunds over the API$/);
  // Linked to the item, from the session.
  const [link] = await db
    .select()
    .from(s.codeWorkLink)
    .where(
      and(
        eq(s.codeWorkLink.workItemId, item),
        eq(s.codeWorkLink.target, "pull_request"),
      ),
    );
  assert.equal(link!.targetId, pr!.id);
  assert.equal(link!.source, "agent_session");
  assert.equal(link!.agentSessionId, started.id);
  // The session knows its pull request; its card and thread show it.
  const after = await f.session(started.id);
  assert.equal(after.pullRequestId, pr!.id);
  assert.equal(after.pullRequestUrl, pr!.webUrl);
  const [card] = await db
    .select()
    .from(s.channelMessage)
    .where(eq(s.channelMessage.id, sessionCardId(started.id)));
  assert.equal(
    (card!.payload as unknown as SessionCardPayload).pullRequest?.id,
    pr!.id,
  );
  const thread = await db
    .select({ body: s.channelMessage.body })
    .from(s.channelMessage)
    .where(eq(s.channelMessage.threadRootId, sessionCardId(started.id)));
  assert.equal(
    thread.filter((m) => m.body.startsWith("Opened pull request")).length,
    1,
  );
  // Agent-authored from Lictory's own provenance.
  const entity = await f.prEntity(pr!.id);
  assert.equal(entity?.agentAuthored, true);
  assert.equal(entity?.agentSessionId, started.id);
  assert.deepEqual(await codeProjectionDrift(db, f.organizationId), []);
});

void test("a pull request Lictory cannot open is explained in the session's log and thread and on the item, once", async () => {
  const f = await fixture();
  const item = await f.task("Refunds over the API");
  const started = await startSession(
    db,
    { userId: f.ada },
    {
      organizationId: f.organizationId,
      agentId: f.forge.id,
      prompt: "Implement the refund endpoint.",
      workItemId: item,
      channelId: f.channelId,
    },
  );
  const row = await f.session(started.id);
  // The branch landed in a repository that does not serve the item's
  // project, so opening its pull request is refused.
  const completion: SessionCompletion = {
    organizationId: f.organizationId,
    sessionId: row.id,
    agentId: f.forge.id,
    ownerId: f.ada,
    agentName: "Forge",
    agentHandle: f.forge.handle,
    requestedById: f.ada,
    projectId: f.projectId,
    workItemId: item,
    repositoryId: f.repositoryIds.ops,
    repositoryUrl: null,
    baseBranch: null,
    branch: row.branch!,
    title: row.title,
    summary: "Done.",
    attempt: row.attempts,
  };
  await sessionPushed(completion);
  await sessionPushed(completion);
  assert.equal((await f.pullRequests()).length, 0);
  const errors = (
    await db
      .select()
      .from(s.agentSessionEvent)
      .where(eq(s.agentSessionEvent.sessionId, row.id))
  ).filter((e) => e.type === "error");
  assert.equal(errors.length, 1);
  const message = (errors[0]!.data as { message: string }).message;
  assert.match(message, /^Lictory could not open a pull request for /);
  assert.match(message, new RegExp(row.branch!));
  const notes = (
    await db
      .select()
      .from(s.channelMessage)
      .where(eq(s.channelMessage.channelId, f.channelId))
  ).filter((m) => m.kind === "system" && m.body === message);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.threadRootId, row.threadRootMessageId);
  const refused = await db
    .select()
    .from(s.activity)
    .where(
      and(
        eq(s.activity.workItemId, item),
        eq(s.activity.action, "code_pull_request_refused"),
      ),
    );
  assert.equal(refused.length, 1);
  assert.equal(refused[0]!.actorId, "system");
  assert.equal(refused[0]!.detail?.agentName, "Forge");
  assert.ok(String(refused[0]!.detail?.reason).length > 0);
});

void test("Build: the reviewer agent reviews each head, the Definition of Done follows ingest and a person's merge delivers the revision", async () => {
  const f = await fixture();
  const story = await f.agreedStory("Refund retries");
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
      ],
    },
  );
  await f.policy("build");
  assert.equal((await runDispatcher(db)).started, 1);
  const implemented = await implement(f, f.repos.pay);
  const [pr] = await f.pullRequests();
  assert.ok(pr, "the session's pull request opened");
  assert.equal(await f.passing(story.workItemId, "pull_request_merged"), false);

  // Opening it started Hawk's review session for this head, once.
  const review = (await f.sessions()).find((x) => x.agentId === f.hawk.id);
  assert.ok(review, "the reviewer agent's session started");
  assert.equal(review.requestedById, f.bo);
  assert.equal(review.repositoryId, pr.repositoryId);
  assert.equal(review.branch, pr.headBranch);
  assert.match(review.prompt, new RegExp(`Review pull request ${pr.id}`));
  assert.match(review.prompt, new RegExp(pr.headSha));
  await f.deliver("pull_request", {
    repository: host.repositoryPayload(f.repos.pay.externalId),
    pull_request: { number: pr.number },
  });
  assert.equal(
    (await f.sessions()).filter((x) => x.agentId === f.hawk.id).length,
    1,
  );

  // Before CI reports, the CI check waits: no check is no evidence.
  assert.equal(await f.passing(story.workItemId, "checks_passed"), false);

  // A connected host with a linked open pull request is evidence, never
  // "no code host": the checks say what the pull request is waiting for.
  await f.ci(f.repos.pay, pr.number, pr.headSha, "failure");
  const open = await f.doneChecks(story.workItemId);
  assert.ok(open.every((c) => !c.detail.includes("No code host")));
  assert.match(
    open.find((c) => c.kind === "pull_request_merged")!.detail,
    /^Waiting for .*#\d+ .* to be merged\.$/,
  );
  assert.match(
    open.find((c) => c.kind === "checks_passed")!.detail,
    /Failing: ci/,
  );

  // CI goes green on the host; ingest re-evaluates the Definition of Done.
  await f.ci(f.repos.pay, pr.number, pr.headSha, "success");
  assert.equal(await f.passing(story.workItemId, "checks_passed"), true);
  assert.equal(
    await f.passing(story.workItemId, "code_review_approved"),
    false,
  );

  // Forge may not review its own pull request.
  await assert.rejects(
    f.service.reviewPullRequest(
      {
        userId: f.ada,
        surface: "runner",
        agentName: "Forge",
        agentScope: {
          id: f.forge.id,
          organizationId: f.organizationId,
          name: "Forge",
          handle: f.forge.handle,
          access: "write",
          projectIds: null,
          sessionId: implemented.sessionId,
        },
      },
      {
        organizationId: f.organizationId,
        pullRequestId: pr.id,
        decision: "approve",
      },
    ),
    refusal("forbidden", /its own pull request/),
  );
  // Hawk reviews from its session, for the head it read.
  const { principal } = await claimAndStart(f.runner, f.hawk.id);
  assert.equal(principal.agent?.id, f.hawk.id);
  await assert.rejects(
    invoke(context(principal), "reviewCodePullRequest", {
      organizationId: f.organizationId,
      pullRequestId: pr.id,
      decision: "approve",
      expectedHeadSha: "f".repeat(40),
    }),
    (error: Error) => error.message.includes("new commits"),
  );
  await invoke(context(principal), "reviewCodePullRequest", {
    organizationId: f.organizationId,
    pullRequestId: pr.id,
    decision: "approve",
    body: "Retries reuse the transaction id; tests cover a double submit.",
    expectedHeadSha: pr.headSha,
  });
  assert.equal(await f.passing(story.workItemId, "code_review_approved"), true);
  // The verdict is on the host, signed.
  await f.outbox.processDue();
  assert.ok(
    host
      .comments(f.repos.pay.externalId, pr.number)
      .some(
        (c) =>
          c.body.includes("**Approved** at") && c.body.includes("Hawk via Bo"),
      ),
  );
  const entity = await f.prEntity(pr.id);
  assert.equal(entity?.reviews[0]?.agentId, f.hawk.id);
  assert.equal(entity?.reviews[0]?.current, true);
  // The item's Code panel says what the Definition of Done counts: the
  // review recorded in Lictory on the head, whatever the host decided.
  const links = await db
    .select({ data: s.codeEntity.data })
    .from(s.codeEntity)
    .where(
      and(
        eq(s.codeEntity.organizationId, f.organizationId),
        eq(s.codeEntity.type, "codeLink"),
        eq(s.codeEntity.workItemId, story.workItemId),
      ),
    );
  const prLink = links
    .map(
      (l) => l.data as { summary?: { target: string; reviewedHere?: string } },
    )
    .find((l) => l.summary?.target === "pull_request");
  assert.equal(prLink?.summary?.reviewedHere, "approve");
  // Build: nothing merges by itself.
  assert.equal((await f.writes()).filter((w) => w.kind === "merge").length, 0);

  // Bo merges the head he saw; the host's answer moves the item to Done
  // with the delivered revision.
  await f.service.merge(
    { userId: f.bo },
    {
      organizationId: f.organizationId,
      pullRequestId: pr.id,
      expectedHeadSha: pr.headSha,
    },
  );
  await f.outbox.processDue();
  const done = await f.item(story.workItemId);
  assert.equal(done.category, "done");
  assert.equal(done.deliveredRevisionId, story.revisionId);
  const [claim] = await db
    .select()
    .from(s.workItemClaim)
    .where(eq(s.workItemClaim.workItemId, story.workItemId));
  assert.equal(claim!.state, "completed");
  const [merged] = await f.pullRequests();
  assert.equal(merged!.mergeRequestedById, f.bo);
  // The item's history says who merged it and who reviewed it.
  const history = await db
    .select()
    .from(s.activity)
    .where(eq(s.activity.workItemId, story.workItemId));
  const mergedEntries = history.filter(
    (a) => a.action === "code_pull_request_merged",
  );
  assert.equal(mergedEntries.length, 1);
  assert.equal(mergedEntries[0]!.actorId, f.bo);
  const reviewed = history.find((a) => a.action === "code_review_approved");
  assert.equal(reviewed?.actorId, f.bo);
  assert.equal(reviewed?.detail?.performedVia, "Hawk");
  assert.deepEqual(await codeProjectionDrift(db, f.organizationId), []);
});

void test("Autopilot merges once per head, attributed to the policy, and refuses a moved head, a failing check, a lowered policy and a revoked administrator", async () => {
  const f = await fixture();
  // Bo administers Payments and saves Autopilot.
  await f.run({
    type: "setProjectMember",
    projectId: f.projectId,
    userId: f.bo,
    role: "admin",
  });
  const story = await f.agreedStory("Refund retries");
  await f.policy("autopilot", f.bo);
  assert.equal((await runDispatcher(db)).started, 1);
  await implement(f, f.repos.pay);
  const [pr] = await f.pullRequests();
  const hawkSession = await claimAndStart(f.runner, f.hawk.id);
  const approve = (headSha: string) =>
    invoke(context(hawkSession.principal), "reviewCodePullRequest", {
      organizationId: f.organizationId,
      pullRequestId: pr!.id,
      decision: "approve",
      expectedHeadSha: headSha,
    });
  const merges = async () =>
    (await f.writes()).filter((w) => w.kind === "merge");

  // Approved, but the host has reported no checks: no check is no
  // evidence that CI passed, so Autopilot waits.
  await approve(pr!.headSha);
  assert.equal((await merges()).length, 0);
  assert.match(
    (await f.doneChecks(story.workItemId)).find(
      (c) => c.kind === "checks_passed",
    )!.detail,
    /The code host has reported no checks for the head commit of/,
  );
  const autopilotWaited = await db
    .select()
    .from(s.autopilotMerge)
    .where(eq(s.autopilotMerge.workItemId, story.workItemId));
  assert.equal(autopilotWaited.length, 0);

  // A failing check: nothing merges, even with the approval.
  await f.ci(f.repos.pay, pr!.number, pr!.headSha, "failure");
  assert.equal((await merges()).length, 0);

  // New commits move the head: the approval was for the old one.
  const moved = host.pushBranch(f.repos.pay.externalId, pr!.headBranch);
  host.updatePullRequest(f.repos.pay.externalId, pr!.number, {
    headSha: moved,
  });
  await f.deliver("pull_request", {
    action: "synchronize",
    repository: host.repositoryPayload(f.repos.pay.externalId),
    pull_request: { number: pr!.number },
  });
  await f.ci(f.repos.pay, pr!.number, moved, "success");
  assert.equal(await f.passing(story.workItemId, "checks_passed"), true);
  assert.equal((await merges()).length, 0);
  // The executor itself refuses a head that is not the current one.
  const refused = await db.transaction(async (tx) => {
    await lock(tx, f.organizationId);
    return claimPorts().merges.requestMerge(tx, {
      organizationId: f.organizationId,
      projectId: f.projectId,
      workItemId: story.workItemId,
      pullRequestId: pr!.id,
      headSha: pr!.headSha,
      policyVersion: 1,
      authorizedById: f.bo,
      idempotencyKey: "stale",
    });
  });
  assert.equal(refused.requested, false);
  assert.match((refused as { reason: string }).reason, /new commits/);

  // Hawk approves the new head: Autopilot merges it, once.
  await approve(moved);
  const [merge] = await merges();
  assert.ok(merge, "Autopilot queued the merge");
  assert.equal(merge.requestedById, f.bo);
  assert.equal(merge.performedVia, "Autopilot · policy set by Bo Engineer");
  assert.equal(
    (merge.payload as { expectedHeadSha: string }).expectedHeadSha,
    moved,
  );
  await db.transaction((tx) =>
    followDefinitionOfDone(tx, f.organizationId, [story.workItemId]),
  );
  await runDispatcher(db);
  assert.equal((await merges()).length, 1);
  const attempts = await db
    .select()
    .from(s.autopilotMerge)
    .where(eq(s.autopilotMerge.workItemId, story.workItemId));
  assert.deepEqual(
    attempts.map((a) => [a.headSha, a.outcome]),
    [[moved, "requested"]],
  );
  // The host shows who merges and under which policy.
  await f.outbox.processDue();
  assert.ok(
    host
      .comments(f.repos.pay.externalId, pr!.number)
      .some((c) => c.body.includes("Autopilot · policy set by Bo Engineer")),
  );
  const [merged] = await f.pullRequests();
  assert.equal(merged!.state, "merged");
  assert.equal(merged!.mergedVia, "Autopilot · policy set by Bo Engineer");
  assert.equal((await f.prEntity(pr!.id))?.mergedVia, merged!.mergedVia);
  const done = await f.item(story.workItemId);
  assert.equal(done.category, "done");
  assert.equal(done.deliveredRevisionId, story.revisionId);
  // The organization's audit log records the merge, attributed to Bo's
  // policy, once.
  const audited = await db
    .select()
    .from(s.auditEvent)
    .where(
      and(
        eq(s.auditEvent.organizationId, f.organizationId),
        eq(s.auditEvent.action, "autopilot.merged"),
      ),
    );
  assert.equal(audited.length, 1);
  assert.equal(audited[0]!.actorId, f.bo);
  assert.equal(audited[0]!.targetId, pr!.id);
  assert.equal(audited[0]!.detail?.headSha, moved);
  // The Done item keeps the evidence it was delivered on.
  const record = (
    await db
      .select()
      .from(s.activity)
      .where(
        and(
          eq(s.activity.workItemId, story.workItemId),
          eq(s.activity.action, "definition_of_done_passed"),
        ),
      )
  )[0];
  const recorded = record?.detail as {
    checks: { detail?: string }[];
    pullRequests: { state: string }[];
  };
  assert.ok(recorded.checks.every((c) => typeof c.detail === "string"));
  assert.ok(recorded.pullRequests.length > 0);

  // A second item: lowering autonomy to Build stops Autopilot.
  const second = await f.agreedStory("Partial refunds");
  assert.equal((await runDispatcher(db)).started, 1);
  await implement(f, f.repos.pay);
  const secondPr = (await f.pullRequests()).at(-1)!;
  await f.policy("build", f.bo);
  const reviewer = await claimAndStart(f.runner, f.hawk.id);
  await f.ci(f.repos.pay, secondPr.number, secondPr.headSha, "success");
  await invoke(context(reviewer.principal), "reviewCodePullRequest", {
    organizationId: f.organizationId,
    pullRequestId: secondPr.id,
    decision: "approve",
    expectedHeadSha: secondPr.headSha,
  });
  assert.equal((await merges()).length, 1);
  assert.equal((await f.item(second.workItemId)).category, "started");

  // Back on Autopilot, but Bo no longer administers Payments: refused,
  // recorded once for the head, and nothing merges.
  await f.policy("autopilot", f.bo);
  await f.run({
    type: "setProjectMember",
    projectId: f.projectId,
    userId: f.bo,
    role: "member",
  });
  await db.transaction((tx) =>
    followDefinitionOfDone(tx, f.organizationId, [second.workItemId]),
  );
  await runDispatcher(db);
  assert.equal((await merges()).length, 1);
  const refusals = await db
    .select()
    .from(s.autopilotMerge)
    .where(eq(s.autopilotMerge.workItemId, second.workItemId));
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0]!.outcome, "refused");
  assert.match(refusals[0]!.detail ?? "", /no longer administers/);
  assert.deepEqual(await codeProjectionDrift(db, f.organizationId), []);
});

void test("nothing crosses organizations: evidence, workspaces and reviews stay in their tenant", async () => {
  const f = await fixture();
  const g = await fixture();
  const item = await f.task("Refunds over the API");
  host.pushBranch(f.repos.pay.externalId, "pay-1-refunds");
  const opened = host.openPullRequest(f.repos.pay.externalId, {
    head: "pay-1-refunds",
    title: "PAY-1: refunds",
  });
  await f.deliver("pull_request", {
    repository: host.repositoryPayload(f.repos.pay.externalId),
    pull_request: { number: opened.number },
  });
  const [pr] = await f.pullRequests();
  assert.ok(pr, "the pull request is mirrored");
  // Evidence asked for in another organization finds nothing of this one.
  const evidence = createCodeEvidence(db);
  const theirs = await db.transaction((tx) =>
    evidence.evidence(tx, g.organizationId, [item]),
  );
  assert.deepEqual(theirs.get(item), { connected: true, pullRequests: [] });
  const ours = await db.transaction((tx) =>
    evidence.evidence(tx, f.organizationId, [item]),
  );
  const found = ours.get(item);
  assert.ok(found?.connected && found.pullRequests[0]?.id === pr.id);
  // A session in the other organization cannot name this one's repository.
  const theirItem = await g.task("Rotate keys");
  await startSession(
    db,
    { userId: g.ada },
    {
      organizationId: g.organizationId,
      agentId: g.forge.id,
      prompt: "Rotate keys.",
      workItemId: theirItem,
      repositoryId: f.repositoryIds.pay,
    },
  );
  const { assignment } = await claimAndStart(g.runner);
  await assert.rejects(
    sessionWorkspace(db, g.runner, assignment.sessionId, assignment.leaseToken),
    refusal("validation", /does not serve/),
  );
  // Nor review its pull request.
  await assert.rejects(
    g.service.reviewPullRequest(
      { userId: g.ada },
      {
        organizationId: g.organizationId,
        pullRequestId: pr.id,
        decision: "approve",
      },
    ),
    refusal("not_found"),
  );
  await assert.rejects(
    f.service.reviewPullRequest(
      { userId: g.ada },
      {
        organizationId: f.organizationId,
        pullRequestId: pr.id,
        decision: "approve",
      },
    ),
    refusal("forbidden"),
  );
});

void test("a person who names a repository when asking an agent in a channel gets a session there", async () => {
  const f = await fixture();
  const ask = (body: string) =>
    db.transaction((tx) =>
      postMessage(
        tx,
        { userId: f.ada },
        {
          organizationId: f.organizationId,
          channelId: f.channelId,
          messageId: crypto.randomUUID(),
          threadRootId: null,
          body,
        },
      ),
    );
  const mention = `@[${f.forge.handle}](agent:${f.forge.id})`;
  await ask(`${mention} fix the retry in ${f.repos.web.fullName}.`);
  await ask(
    `${mention} look at https://github.example/${f.repos.ops.fullName}/pull/3 please`,
  );
  await ask(`${mention} summarize the thread`);
  const started = await f.sessions();
  assert.deepEqual(
    started.map((x) => x.repositoryId),
    [f.repositoryIds.web, f.repositoryIds.ops, null],
  );
  // Text only chooses where; the workspace still checks the owner's access
  // to the repository (Ada works in Operations too).
  await claimAndStart(f.runner);
  const { assignment } = await claimAndStart(f.runner);
  const { repository } = await sessionWorkspace(
    db,
    f.runner,
    assignment.sessionId,
    assignment.leaseToken,
  );
  assert.equal(
    repository?.url,
    `https://github.example/${f.repos.ops.fullName}.git`,
  );
});

void test("an agent asked in a project's channel works in that project's only repository unless the message names another", async () => {
  const f = await fixture();
  const channel = async (name: string, projectId: string) => {
    const channelId = crypto.randomUUID();
    await f.run({
      type: "createChannel",
      channelId,
      kind: "public",
      name: `${name}-${crypto.randomUUID().slice(0, 6)}`,
      home: { projectId },
    });
    return channelId;
  };
  // Operations has one repository; Payments has two.
  const ops = await channel("ops", f.opsId);
  const pay = await channel("pay", f.projectId);
  const ask = (channelId: string, body: string) =>
    db.transaction((tx) =>
      postMessage(
        tx,
        { userId: f.ada },
        {
          organizationId: f.organizationId,
          channelId,
          messageId: crypto.randomUUID(),
          threadRootId: null,
          body,
        },
      ),
    );
  const mention = `@[${f.forge.handle}](agent:${f.forge.id})`;
  await ask(ops, `${mention} draft the runbook`);
  await ask(ops, `${mention} fix the retry in ${f.repos.web.fullName}`);
  await ask(pay, `${mention} draft the runbook`);
  const started = await f.sessions();
  assert.deepEqual(
    started.map((x) => x.repositoryId),
    [f.repositoryIds.ops, f.repositoryIds.web, null],
  );
});
