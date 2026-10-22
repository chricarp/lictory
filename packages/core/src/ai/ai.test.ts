import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { directory } from "@lictory/core/domain/service";
import {
  projectionDrift,
  projectionService,
} from "@lictory/core/domain/projection-reader.test-helper";
import { seedOrganization } from "@lictory/core/domain/organization";
import {
  PROTOCOL,
  pageSchema,
  type Command,
  type Entity,
  type EntityOf,
} from "@lictory/core/contracts/protocol";
import { AI_ACTOR_ID } from "@lictory/core/contracts/ai";
import {
  AnalyzerError,
  type Analyzer,
  type ItemReviewOutput,
  type PullRequestOutput,
} from "@lictory/core/ai/analyzer";
import { processAiRuns } from "@lictory/core/ai/runner";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_ai_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
const service = projectionService(db);
const previousKey = process.env.OPENAI_API_KEY;
let created = false;
before(async () => {
  process.env.OPENAI_API_KEY = "test-key";
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  process.env.OPENAI_API_KEY = previousKey;
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});

const finding = (
  itemKey: string,
  severity: "blocker" | "major" | "minor" | "info",
  title: string,
  edit: ItemReviewOutput["findings"][number]["edit"] = null,
): ItemReviewOutput["findings"][number] => ({
  itemKey,
  kind: edit ? "suggestion" : "question",
  category: "failure_behavior",
  severity,
  title,
  detail: `${title} matters.`,
  evidence: [],
  question: edit ? null : "What should happen?",
  recommendation: null,
  edit,
  contextRefs: [],
});
function fakeAnalyzer(
  item: ItemReviewOutput["findings"] = [],
  pr: (
    context: Parameters<Analyzer["reviewPullRequest"]>[0],
  ) => PullRequestOutput["findings"] = () => [],
): Analyzer & { calls: number } {
  const analyzer = {
    model: "fake",
    calls: 0,
    async reviewItem() {
      analyzer.calls++;
      return {
        summary: "Mostly clear.",
        strengths: ["Clear intent"],
        findings: item,
      };
    },
    async reviewPullRequest(
      context: Parameters<Analyzer["reviewPullRequest"]>[0],
    ) {
      analyzer.calls++;
      return { summary: "Reviewed.", strengths: [], findings: pr(context) };
    },
  };
  return analyzer;
}

async function fixture() {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const reviewerId = crypto.randomUUID();
  await db.insert(s.user).values([
    { id: userId, name: "Owner", email: `${userId}@example.test` },
    { id: reviewerId, name: "Engineer", email: `${reviewerId}@example.test` },
  ]);
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Org",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values([
    {
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: "owner",
      createdAt: new Date(),
    },
    {
      id: crypto.randomUUID(),
      organizationId,
      userId: reviewerId,
      role: "member",
      createdAt: new Date(),
    },
  ]);
  await seedOrganization(db, organizationId);
  const command = (c: Command, actor = userId) =>
    service.mutate(actor, {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command: c,
    });
  const projectId = crypto.randomUUID();
  await command({
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
  });
  const roles = Object.fromEntries(
    (await directory(db, userId, organizationId)).disciplines
      .filter((d) => d.projectId === projectId)
      .map((d) => [d.name, d.id]),
  ) as Record<"Product" | "Engineering" | "QA", string>;
  await command({
    type: "setDisciplineMember",
    projectId,
    disciplineId: roles.Engineering,
    userId: reviewerId,
    member: true,
  });
  const dir = await directory(db, userId, organizationId);
  const types = Object.fromEntries(dir.types.map((t) => [t.name, t.id]));
  const epicId = crypto.randomUUID();
  const storyId = crypto.randomUUID();
  await command({
    type: "createWorkItem",
    projectId,
    workItemId: epicId,
    typeId: types.Epic!,
    parentId: null,
    title: "Safe payments",
    description: "Customers are never charged twice.",
  });
  await command({
    type: "createWorkItem",
    projectId,
    workItemId: storyId,
    typeId: types.Story!,
    parentId: epicId,
    title: "Retry after timeout",
    description: "Retry the payment when the provider times out.",
  });
  const entities = async (workItemId: string) =>
    pageSchema
      .parse(
        await service.read(userId, { organizationId, projectId, workItemId }),
      )
      .changes.flatMap((c) => (c.operation === "upsert" ? [c.entity] : []));
  const of = <T extends Entity["type"]>(all: Entity[], type: T) =>
    all.filter((e): e is EntityOf<T> => e.type === type);
  const runs = async (workItemId: string) =>
    of(await entities(workItemId), "aiRun").sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  const latest = async (workItemId: string) =>
    of(await entities(workItemId), "revision").sort(
      (a, b) => b.number - a.number,
    )[0]!;
  return {
    organizationId,
    userId,
    reviewerId,
    roles,
    projectId,
    epicId,
    storyId,
    command,
    entities,
    of,
    runs,
    latest,
  };
}

void test("Lictory Intelligence review is opt-in, analyses the tree and scores validated findings", async () => {
  const f = await fixture();
  const request = () =>
    f.command({
      type: "requestAiReview",
      workItemId: f.epicId,
      runId: crypto.randomUUID(),
    });
  await assert.rejects(request(), /turned off/);
  await assert.rejects(
    f.command({ type: "setAiPolicy", enabled: true }, f.reviewerId),
    /administrator/,
  );
  await f.command({ type: "setAiPolicy", enabled: true });
  assert.equal(
    (await directory(db, f.userId, f.organizationId)).ai.enabled,
    true,
  );
  await request();
  await assert.rejects(request(), /already in progress/);
  assert.equal((await f.runs(f.epicId))[0]!.status, "queued");

  const analyzer = fakeAnalyzer([
    finding("PAY-1", "blocker", "No definition of a duplicate charge"),
    finding("PAY-2", "major", "Retries are not bounded", {
      section: "Behavior",
      find: "Retry the payment",
      replace:
        "Retry the payment at most twice, with the same idempotency key,",
    }),
    finding("PAY-2", "minor", "Quote that does not exist", {
      section: "Behavior",
      find: "invented text",
      replace: "x",
    }),
    finding("PAY-999", "blocker", "About an item that was not analysed"),
  ]);
  assert.deepEqual(await processAiRuns(db, { analyzer }), {
    completed: 1,
    failed: 0,
    superseded: 0,
  });
  const [run] = await f.runs(f.epicId);
  assert.equal(run!.status, "completed");
  // 100 − blocker 25 − major 10 − minor 3; the unknown item is dropped.
  assert.equal(run!.score, 62);
  assert.equal(run!.findings.length, 3);
  assert.equal(run!.findings[1]!.workItemId, f.storyId);
  assert.ok(run!.findings[1]!.edit);
  assert.equal(run!.findings[2]!.edit, null, "edits must quote real content");
  assert.deepEqual(
    Object.keys(run!.contextRevisions).sort(),
    [f.epicId, f.storyId].sort(),
  );
  const completed = f
    .of(await f.entities(f.epicId), "activity")
    .find((a) => a.action === "ai_review_completed");
  assert.equal(completed?.actorId, AI_ACTOR_ID);
});

void test("corrective PRs are authored by Lictory Intelligence, owned by the requester, and outdated reviews cannot produce them", async () => {
  const f = await fixture();
  await f.command({ type: "setAiPolicy", enabled: true });
  await f.command({
    type: "requestAiReview",
    workItemId: f.epicId,
    runId: crypto.randomUUID(),
  });
  await processAiRuns(db, {
    analyzer: fakeAnalyzer([
      finding("PAY-2", "major", "Retries are not bounded", {
        section: "Behavior",
        find: "Retry the payment",
        replace: "Retry the payment at most twice",
      }),
    ]),
  });
  const [run] = await f.runs(f.epicId);
  const mainBefore = await f.latest(f.storyId);
  const pullRequestId = crypto.randomUUID();
  const create = () =>
    f.command({
      type: "createAiCorrectivePr",
      workItemId: f.storyId,
      runId: run!.id,
      findingIds: ["f1"],
      branchId: crypto.randomUUID(),
      pullRequestId,
    });
  await create();
  const story = await f.entities(f.storyId);
  const pr = f.of(story, "pullRequest").find((p) => p.id === pullRequestId)!;
  assert.equal(pr.authorId, AI_ACTOR_ID);
  assert.equal(pr.status, "open");
  const source = f.of(story, "specBranch").find((b) => b.id === pr.sourceId)!;
  assert.ok(source.collaboratorIds.includes(f.userId));
  const head = f.of(story, "specCommit").find((c) => c.id === source.headId)!;
  assert.equal(head.authorId, AI_ACTOR_ID);
  assert.match(head.content, /Retry the payment at most twice/);
  // Main is untouched until humans merge.
  assert.equal((await f.latest(f.storyId)).id, mainBefore.id);
  // The Epic's review records the PR, synchronized into the Epic's scope.
  assert.equal(
    (await f.runs(f.epicId))[0]!.correctivePullRequests[f.storyId],
    pullRequestId,
  );
  // Opening the PR queues the Lictory Intelligence review action on it.
  assert.equal((await f.runs(f.storyId))[0]?.kind, "pr_action");
  await assert.rejects(create(), /already exists/);

  // A new main revision of an analysed item makes the review outdated.
  await f.command({
    type: "updateSpecification",
    workItemId: f.storyId,
    baseRevisionId: mainBefore.id,
    title: "Retry after timeout",
    content: "Retry once.",
  });
  const [stale] = await f.runs(f.epicId);
  assert.ok(stale!.staleAt);
  assert.match(stale!.staleReason!, /PAY-2 changed to revision 2/);
  await assert.rejects(
    f.command({
      type: "createAiCorrectivePr",
      workItemId: f.epicId,
      runId: run!.id,
      findingIds: ["f1"],
      branchId: crypto.randomUUID(),
      pullRequestId: crypto.randomUUID(),
    }),
    /outdated/,
  );
});

void test("the Lictory Intelligence review action re-runs per commit, comments without resolving, and gates merge when required", async () => {
  const f = await fixture();
  await f.command({ type: "setAiPolicy", enabled: true });
  await f.command({
    type: "updateProject",
    projectId: f.projectId,
    aiActionPolicy: "required",
  });
  const main = await f.latest(f.storyId);
  const branchId = crypto.randomUUID();
  await f.command({
    type: "createBranch",
    workItemId: f.storyId,
    baseRevisionId: main.id,
    branchId,
    name: "retries",
  });
  const branch = async () =>
    f
      .of(await f.entities(f.storyId), "specBranch")
      .find((b) => b.id === branchId)!;
  const commit = async (content: string) =>
    f.command({
      type: "commitBranch",
      workItemId: f.storyId,
      branchId,
      baseCommitId: (await branch()).headId,
      title: "Retry after timeout",
      content,
      message: "Edit",
    });
  await commit(
    "Retry the payment twice.\n\n## Acceptance criteria\n\n- [ ] One charge",
  );
  const pullRequestId = crypto.randomUUID();
  await f.command({
    type: "createPullRequest",
    workItemId: f.storyId,
    pullRequestId,
    sourceId: branchId,
    targetId: f
      .of(await f.entities(f.storyId), "specBranch")
      .find((b) => b.name === "main")!.id,
    title: "Bound retries",
    description: "Two retries.",
    draft: true,
  });
  assert.equal((await f.runs(f.storyId)).length, 0, "drafts are not reviewed");
  await f.command({
    type: "setPullRequestDraft",
    workItemId: f.storyId,
    pullRequestId,
    draft: false,
  });
  assert.equal((await f.runs(f.storyId))[0]!.status, "queued");
  await commit(
    "Retry the payment twice with the same key.\n\n## Acceptance criteria\n\n- [ ] One charge",
  );
  const [newest, older] = await f.runs(f.storyId);
  assert.equal(older!.status, "superseded");
  assert.equal(newest!.headCommitId, (await branch()).headId);

  await f.command({
    type: "requestPullRequestReview",
    workItemId: f.storyId,
    pullRequestId,
    disciplineId: f.roles.Engineering,
    userId: f.reviewerId,
    required: true,
  });
  const heads = async () => {
    const all = await f.entities(f.storyId);
    const branches = f.of(all, "specBranch");
    return {
      sourceHeadId: branches.find((b) => b.id === branchId)!.headId,
      targetHeadId: branches.find((b) => b.name === "main")!.headId,
    };
  };
  const reviewId = f
    .of(await f.entities(f.storyId), "prReview")
    .find((r) => r.pullRequestId === pullRequestId)!.id;
  await f.command(
    {
      type: "decidePullRequest",
      workItemId: f.storyId,
      pullRequestId,
      reviewId,
      decision: "approve",
      ...(await heads()),
    },
    f.reviewerId,
  );
  const merge = async () =>
    f.command({
      type: "mergePullRequest",
      workItemId: f.storyId,
      pullRequestId,
      ...(await heads()),
    });
  await assert.rejects(merge(), /still reviewing/);

  await processAiRuns(db, {
    analyzer: fakeAnalyzer([], (context) => [
      {
        ...finding("PAY-2", "blocker", "Timeout duration undefined", {
          section: "Behavior",
          find: "twice with the same key.",
          replace: "twice with the same key after a 30 second timeout.",
        }),
        itemKey: context.item.key,
        previousFindingId: null,
      },
    ]),
  });
  const [done] = await f.runs(f.storyId);
  assert.equal(done!.status, "completed");
  let threads = f
    .of(await f.entities(f.storyId), "thread")
    .filter((t) => t.pullRequestId === pullRequestId);
  assert.equal(threads.length, 2, "one summary and one finding");
  assert.ok(threads.every((t) => t.authorId === AI_ACTOR_ID));
  const blocker = threads.find((t) => t.id === done!.findings[0]!.threadId)!;
  assert.equal(
    blocker.blocking,
    true,
    "required policy turns blockers into blocking threads",
  );
  await assert.rejects(merge(), /blocking/);

  // The requester commits the suggestion; a new head re-runs the action.
  await f.command({
    type: "applyAiSuggestion",
    workItemId: f.storyId,
    runId: done!.id,
    findingId: "f1",
  });
  const afterSuggestion = await f.entities(f.storyId);
  const headCommit = f
    .of(afterSuggestion, "specCommit")
    .find(
      (c) => c.id === branchHead(f.of(afterSuggestion, "specBranch"), branchId),
    )!;
  assert.match(headCommit.content, /30 second timeout/);
  assert.equal(headCommit.authorId, f.userId);
  await assert.rejects(
    f.command({
      type: "applyAiSuggestion",
      workItemId: f.storyId,
      runId: done!.id,
      findingId: "f1",
    }),
    /already committed/,
  );
  assert.equal((await f.runs(f.storyId))[0]!.status, "queued");

  // The issue is gone in the new run: the old thread gets a note, not a resolution.
  await processAiRuns(db, { analyzer: fakeAnalyzer([], () => []) });
  threads = f
    .of(await f.entities(f.storyId), "thread")
    .filter((t) => t.pullRequestId === pullRequestId);
  assert.equal(threads.find((t) => t.id === blocker.id)!.status, "open");
  const notes = f
    .of(await f.entities(f.storyId), "message")
    .filter((m) => m.threadId === blocker.id);
  assert.match(notes.at(-1)!.body, /no longer detects/);

  // Humans resolve it; the reviewer re-approves the new result; merge succeeds.
  await f.command({
    type: "setThreadState",
    workItemId: f.storyId,
    threadId: blocker.id,
    resolved: true,
    blocking: true,
  });
  await f.command(
    {
      type: "decidePullRequest",
      workItemId: f.storyId,
      pullRequestId,
      reviewId,
      decision: "approve",
      ...(await heads()),
    },
    f.reviewerId,
  );
  await merge();
});

void test("provider failures are recorded as actionable errors and never block human review", async () => {
  const f = await fixture();
  await f.command({ type: "setAiPolicy", enabled: true });
  await f.command({
    type: "requestAiReview",
    workItemId: f.storyId,
    runId: crypto.randomUUID(),
  });
  const analyzer = fakeAnalyzer();
  analyzer.reviewItem = async () => {
    throw new AnalyzerError(
      "The AI provider is rate limiting requests. Run the review again in a few minutes.",
    );
  };
  assert.equal((await processAiRuns(db, { analyzer })).failed, 1);
  const [run] = await f.runs(f.storyId);
  assert.equal(run!.status, "failed");
  assert.match(run!.error!, /rate limiting/);
  // A new request is accepted, and ordinary review keeps working.
  await f.command({
    type: "requestAiReview",
    workItemId: f.storyId,
    runId: crypto.randomUUID(),
  });
  const latest = await f.latest(f.storyId);
  await f.command({
    type: "requestReview",
    workItemId: f.storyId,
    baseRevisionId: latest.id,
    reviewId: crypto.randomUUID(),
    disciplineId: f.roles.Engineering,
    userId: null,
    required: true,
  });
  // Turning Lictory Intelligence off stops queued runs instead of sending
  // content.
  await f.command({ type: "setAiPolicy", enabled: false });
  const before = analyzer.calls;
  await processAiRuns(db, { analyzer: fakeAnalyzer() });
  const [stopped] = await f.runs(f.storyId);
  assert.equal(stopped!.status, "failed");
  assert.match(stopped!.error!, /turned off/);
  assert.equal(analyzer.calls, before);
  const rows = await db
    .select()
    .from(s.aiRun)
    .where(and(eq(s.aiRun.organizationId, f.organizationId)));
  assert.equal(rows.length, 2, "runs are history, never deleted");
});

function branchHead(branches: EntityOf<"specBranch">[], id: string) {
  return branches.find((b) => b.id === id)!.headId;
}

void test("projections equal a rebuild from the domain", async () => {
  const drift: string[] = [];
  for (const { id } of await db
    .select({ id: s.organization.id })
    .from(s.organization))
    drift.push(...(await projectionDrift(db, id)));
  assert.deepEqual(drift, []);
});
