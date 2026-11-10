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
import {
  parseMarkdownTree,
  placeQuote,
  textModel,
} from "@lictory/core/editor/markdown-text";

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
  readings: (
    context: Parameters<Analyzer["reviewPullRequest"]>[0],
  ) => PullRequestOutput["readings"] = () => [],
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
      return {
        summary: "Reviewed.",
        strengths: [],
        findings: pr(context),
        readings: readings(context),
      };
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
    interrupted: 0,
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

async function queuedReview(f: Awaited<ReturnType<typeof fixture>>) {
  await f.command({ type: "setAiPolicy", enabled: true });
  const runId = crypto.randomUUID();
  await f.command({ type: "requestAiReview", workItemId: f.storyId, runId });
  const row = async () =>
    (await db.select().from(s.aiRun).where(eq(s.aiRun.id, runId)))[0]!;
  const completions = async () =>
    (
      await db
        .select()
        .from(s.activity)
        .where(
          and(
            eq(s.activity.organizationId, f.organizationId),
            eq(s.activity.action, "ai_review_completed"),
          ),
        )
    ).filter((a) => (a.detail as { runId?: string }).runId === runId);
  return { runId, row, completions };
}

void test("a run held by a crashed worker is re-claimed after its lease and completes once", async () => {
  const f = await fixture();
  const run = await queuedReview(f);
  // Worker A claims the run and never comes back from the model.
  let called!: () => void;
  const inModel = new Promise<void>((resolve) => (called = resolve));
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  const slow = fakeAnalyzer([], () => []);
  slow.reviewItem = async () => {
    called();
    await answered;
    return { summary: "Late answer.", strengths: [], findings: [] };
  };
  const workerA = processAiRuns(db, { analyzer: slow, limit: 1 });
  await inModel;
  assert.equal((await run.row()).status, "running");
  assert.equal((await run.row()).attempts, 1);
  // Within the lease no one else takes it.
  const early = fakeAnalyzer();
  await processAiRuns(db, { analyzer: early });
  assert.equal(early.calls, 0);

  const later = new Date(Date.now() + 11 * 60_000);
  const workerB = fakeAnalyzer();
  assert.equal(
    (await processAiRuns(db, { analyzer: workerB, now: () => later }))
      .completed,
    1,
  );
  const completed = await run.row();
  assert.equal(completed.status, "completed");
  assert.equal(completed.attempts, 2);
  assert.equal(completed.summary, "Mostly clear.");

  // Worker A answers after all: its attempt is fenced off.
  answer();
  await workerA;
  const final = await run.row();
  assert.equal(final.summary, "Mostly clear.");
  assert.deepEqual(final.completedAt, completed.completedAt);
  assert.equal((await run.completions()).length, 1);
});

void test("a model call past the run deadline fails the run instead of outliving its lease", async () => {
  const f = await fixture();
  const run = await queuedReview(f);
  const hung = fakeAnalyzer();
  // Ignores the abort signal entirely; the runner still moves on.
  hung.reviewItem = () => new Promise<never>(() => undefined);
  assert.equal(
    (await processAiRuns(db, { analyzer: hung, timeoutMs: 50 })).failed,
    1,
  );
  const row = await run.row();
  assert.equal(row.status, "failed");
  assert.match(row.error!, /did not answer in time/);
});

void test("a run interrupted by shutdown goes back to the queue and completes on the next worker", async () => {
  const f = await fixture();
  const run = await queuedReview(f);
  const stop = new AbortController();
  const interrupted = fakeAnalyzer();
  let aborted = false;
  interrupted.reviewItem = (_context, call) =>
    new Promise((_resolve, reject) => {
      call!.abortSignal!.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      });
      stop.abort();
    });
  assert.equal(
    (
      await processAiRuns(db, {
        analyzer: interrupted,
        signal: stop.signal,
      })
    ).interrupted,
    1,
  );
  assert.ok(aborted, "the provider call is cancelled");
  assert.equal((await run.row()).status, "queued");
  assert.equal(
    (await processAiRuns(db, { analyzer: fakeAnalyzer() })).completed,
    1,
  );
  const row = await run.row();
  assert.equal(row.status, "completed");
  assert.equal(row.attempts, 2);
  assert.equal((await run.completions()).length, 1);
});

void test("a Lictory Intelligence readiness check is an automated check that people can override", async () => {
  const f = await fixture();
  await f.command({ type: "setAiPolicy", enabled: true });
  const storyType = (
    await directory(db, f.userId, f.organizationId)
  ).types.find((t) => t.name === "Story")!.id;
  await f.command({
    type: "publishReadinessChecks",
    projectId: f.projectId,
    baseRevisionId: null,
    rules: {
      [storyType]: [
        { id: "specification", kind: "specification" },
        {
          id: "eng",
          kind: "discipline_approval",
          disciplineIds: [f.roles.Engineering],
        },
        { id: "ai", kind: "intelligence_review", severity: "blocker" },
      ],
    },
  });
  const readiness = async () =>
    f.of(await f.entities(f.storyId), "readiness")[0]!;
  const check = async () =>
    (await readiness()).checks.find((c) => c.key === "ai")!;
  const state = async () =>
    f
      .of(await f.entities(f.storyId), "workItem")
      .find((i) => i.id === f.storyId)!.refinementState;
  assert.equal((await check()).passed, false);
  assert.match((await check()).detail!, /Ask Lictory Intelligence/);

  // The human decision the check sits beside: Engineering approves.
  const revision = await f.latest(f.storyId);
  const reviewId = crypto.randomUUID();
  await f.command({
    type: "requestReview",
    workItemId: f.storyId,
    baseRevisionId: revision.id,
    reviewId,
    disciplineId: f.roles.Engineering,
    userId: f.reviewerId,
    required: true,
  });
  await f.command(
    {
      type: "decideReview",
      workItemId: f.storyId,
      baseRevisionId: revision.id,
      reviewId,
      decision: "approve",
    },
    f.reviewerId,
  );
  assert.notEqual(await state(), "ready");

  // A clean review of the current revision passes the check, and completing
  // it moves the item to Ready without another mutation.
  const review = async (findings: ItemReviewOutput["findings"]) => {
    await f.command({
      type: "requestAiReview",
      workItemId: f.storyId,
      runId: crypto.randomUUID(),
    });
    await processAiRuns(db, { analyzer: fakeAnalyzer(findings) });
  };
  await review([finding("PAY-2", "major", "Retries are not bounded")]);
  const passed = await check();
  assert.equal(passed.passed, true);
  assert.equal(passed.intelligence?.reviewedCurrent, true);
  assert.equal(passed.intelligence?.model, "fake");
  assert.equal(await state(), "ready");
  const moved = f
    .of(await f.entities(f.storyId), "activity")
    .find((a) => a.action === "refinement_changed" && a.detail?.to === "ready");
  assert.equal(moved?.actorId, AI_ACTOR_ID);
  assert.equal(moved?.detail?.reason, "intelligence_review_completed");
  // The check never counts as a discipline's approval.
  assert.ok(
    (await readiness()).checks
      .filter((c) => c.key !== "ai")
      .every((c) => !c.intelligence),
  );

  // A later review that finds a blocker takes readiness away.
  await review([finding("PAY-2", "blocker", "Duplicate charges")]);
  assert.equal((await check()).passed, false);
  assert.match((await check()).detail!, /found 1 blocker in revision/);
  assert.equal(await state(), "in_review");

  // A person can override it for this revision, and withdraw the override.
  const override = (signedOff: boolean) =>
    f.command(
      {
        type: "signOffReadinessCheck",
        workItemId: f.storyId,
        baseRevisionId: revision.id,
        checkId: "ai",
        signedOff,
      },
      f.reviewerId,
    );
  await override(true);
  assert.equal((await check()).intelligence?.overridden, true);
  assert.equal((await check()).signOff?.signedOffBy, f.reviewerId);
  assert.equal(await state(), "ready");
  const recorded = f
    .of(await f.entities(f.storyId), "activity")
    .find((a) => a.action === "readiness_signed_off");
  assert.equal(recorded?.actorId, f.reviewerId);
  assert.equal(recorded?.detail?.override, true);
  await override(false);
  assert.equal(await state(), "in_review");
});

void test("projections equal a rebuild from the domain", async () => {
  const drift: string[] = [];
  for (const { id } of await db
    .select({ id: s.organization.id })
    .from(s.organization))
    drift.push(...(await projectionDrift(db, id)));
  assert.deepEqual(drift, []);
});

void test("a required review action that passes last makes the pull request ready to merge", async () => {
  const f = await fixture();
  await f.command({ type: "setAiPolicy", enabled: true });
  await f.command({
    type: "updateProject",
    projectId: f.projectId,
    aiActionPolicy: "required",
  });
  const main = await f.latest(f.storyId);
  const branchId = crypto.randomUUID(),
    pullRequestId = crypto.randomUUID();
  await f.command({
    type: "createBranch",
    workItemId: f.storyId,
    baseRevisionId: main.id,
    branchId,
    name: "bounded",
  });
  const heads = async () => {
    const branches = f.of(await f.entities(f.storyId), "specBranch");
    return {
      sourceHeadId: branches.find((b) => b.id === branchId)!.headId,
      targetHeadId: branches.find((b) => b.name === "main")!.headId,
      mainId: branches.find((b) => b.name === "main")!.id,
    };
  };
  await f.command({
    type: "commitBranch",
    workItemId: f.storyId,
    branchId,
    baseCommitId: (await heads()).sourceHeadId,
    title: "Retry after timeout",
    content: "Retry twice with the same key.",
    message: "Bound retries",
  });
  await f.command({
    type: "createPullRequest",
    workItemId: f.storyId,
    pullRequestId,
    sourceId: branchId,
    targetId: (await heads()).mainId,
    title: "Bound retries",
    description: "",
    draft: false,
  });
  await f.command({
    type: "requestPullRequestReview",
    workItemId: f.storyId,
    pullRequestId,
    disciplineId: f.roles.Engineering,
    userId: f.reviewerId,
    required: true,
  });
  const reviewId = f
    .of(await f.entities(f.storyId), "prReview")
    .find((r) => r.pullRequestId === pullRequestId)!.id;
  const { sourceHeadId, targetHeadId } = await heads();
  await f.command(
    {
      type: "decidePullRequest",
      workItemId: f.storyId,
      pullRequestId,
      reviewId,
      decision: "approve",
      sourceHeadId,
      targetHeadId,
    },
    f.reviewerId,
  );
  const ready = async () =>
    f
      .of(await f.entities(f.storyId), "activity")
      .filter((a) => a.action === "pull_request_ready_to_merge");
  assert.equal((await ready()).length, 0, "the action is still pending");
  await processAiRuns(db, { analyzer: fakeAnalyzer() });
  const events = await ready();
  assert.equal(events.length, 1);
  assert.equal(events[0]!.actorId, AI_ACTOR_ID);
  assert.equal(events[0]!.detail?.pullRequestId, pullRequestId);
  const notified = await db
    .select()
    .from(s.notification)
    .where(
      and(
        eq(s.notification.organizationId, f.organizationId),
        eq(s.notification.kind, "pull_request_mergeable"),
      ),
    );
  assert.deepEqual(
    notified.map((n) => n.userId),
    [f.userId],
  );
});

// A pull request whose branch adds acceptance criteria, ready for review.
async function criteriaPullRequest(
  f: Awaited<ReturnType<typeof fixture>>,
  policy: "advisory" | "required",
) {
  await f.command({ type: "setAiPolicy", enabled: true });
  await f.command({
    type: "updateProject",
    projectId: f.projectId,
    aiActionPolicy: policy,
  });
  const main = await f.latest(f.storyId);
  const branchId = crypto.randomUUID();
  const pullRequestId = crypto.randomUUID();
  await f.command({
    type: "createBranch",
    workItemId: f.storyId,
    baseRevisionId: main.id,
    branchId,
    name: "criteria",
  });
  const heads = async () => {
    const all = await f.entities(f.storyId);
    const branches = f.of(all, "specBranch");
    const source = branches.find((b) => b.id === branchId)!;
    const target = branches.find((b) => b.name === "main")!;
    return {
      sourceHeadId: source.headId,
      targetHeadId: target.headId,
      mainId: target.id,
      head: f.of(all, "specCommit").find((c) => c.id === source.headId)!,
    };
  };
  const commit = async (content: string) =>
    f.command({
      type: "commitBranch",
      workItemId: f.storyId,
      branchId,
      baseCommitId: (await heads()).sourceHeadId,
      title: "Retry after timeout",
      content,
      message: "Criteria",
    });
  await commit(
    [
      "Retry the payment when the provider times out.",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] A timed-out payment is retried **at most twice**.",
      "- [ ] The customer sees one charge.",
    ].join("\n"),
  );
  await f.command({
    type: "createPullRequest",
    workItemId: f.storyId,
    pullRequestId,
    sourceId: branchId,
    targetId: (await heads()).mainId,
    title: "Acceptance criteria",
    description: "",
    draft: false,
  });
  const threads = async () =>
    f
      .of(await f.entities(f.storyId), "thread")
      .filter((t) => t.pullRequestId === pullRequestId);
  const messages = async (threadId: string) =>
    f
      .of(await f.entities(f.storyId), "message")
      .filter((m) => m.threadId === threadId);
  // The engineer approves the current result, then the owner merges.
  const merge = async () => {
    await f.command({
      type: "requestPullRequestReview",
      workItemId: f.storyId,
      pullRequestId,
      disciplineId: f.roles.Engineering,
      userId: f.reviewerId,
      required: true,
    });
    const { sourceHeadId, targetHeadId } = await heads();
    await f.command(
      {
        type: "decidePullRequest",
        workItemId: f.storyId,
        pullRequestId,
        reviewId: f
          .of(await f.entities(f.storyId), "prReview")
          .find((r) => r.pullRequestId === pullRequestId)!.id,
        decision: "approve",
        sourceHeadId,
        targetHeadId,
      },
      f.reviewerId,
    );
    return f.command({
      type: "mergePullRequest",
      workItemId: f.storyId,
      pullRequestId,
      sourceHeadId,
      targetHeadId,
    });
  };
  return { commit, heads, threads, messages, merge };
}

type Reading = PullRequestOutput["readings"][number];
const agree = (criterionRef: string): Reading => ({
  criterionRef,
  qa: [{ situation: "One timeout", expected: "Charged once" }],
  implementer: { builds: "Idempotent retry", done: "Charged once" },
  diverges: false,
  divergence: null,
  question: null,
  severity: "minor",
  previousFindingId: null,
});
const diverge = (criterionRef: string): Reading => ({
  criterionRef,
  qa: [
    {
      situation: "The provider times out three times",
      expected: "Two retries after the first attempt, then a failure",
    },
  ],
  implementer: {
    builds: "A loop that stops after two attempts in total",
    done: "No more than two provider calls are made",
  },
  diverges: true,
  divergence:
    "For three timeouts QA expects three provider calls; the build makes two, because it counts the first attempt.",
  question: "Does “at most twice” include the first attempt?",
  severity: "major",
  previousFindingId: null,
});

void test("two readings: a divergence becomes an anchored, non-blocking discussion that re-runs continue", async () => {
  const f = await fixture();
  const pr = await criteriaPullRequest(f, "advisory");
  let sent: string[] = [];
  await processAiRuns(db, {
    analyzer: fakeAnalyzer(
      [],
      () => [],
      (context) => {
        sent = context.acceptanceCriteria.map((c) => `${c.ref} ${c.text}`);
        // The model also invents a criterion and repeats one; both are dropped.
        return [diverge("A1"), agree("A2"), diverge("A7"), diverge("A1")];
      },
    ),
  });
  assert.deepEqual(sent, [
    "A1 A timed-out payment is retried at most twice.",
    "A2 The customer sees one charge.",
  ]);
  const [run] = await f.runs(f.storyId);
  assert.equal(run!.status, "completed");
  assert.equal(run!.findings.length, 1, "agreeing criteria create nothing");
  const found = run!.findings[0]!;
  assert.equal(found.severity, "major");
  assert.equal(
    found.readings?.criterion,
    "A timed-out payment is retried at most twice.",
  );

  let threads = await pr.threads();
  assert.equal(threads.length, 2, "one summary and one divergence");
  const thread = threads.find((t) => t.id === found.threadId)!;
  assert.equal(thread.blocking, false);
  assert.deepEqual(thread.anchor, {
    version: 1,
    kind: "document",
    section: "Acceptance criteria",
    quote: "A timed-out payment is retried at most twice.",
  });
  // The anchor is on the committed head the run read, never a live draft, and
  // the reader finds the criterion's exact text there.
  const { head } = await pr.heads();
  assert.equal(thread.commitId, head.id);
  const placed = placeQuote(textModel(parseMarkdownTree(head.content)), {
    quote: thread.anchor.quote,
    section: thread.anchor.section,
  });
  assert.equal(placed.kind, "found");
  const [opening] = await pr.messages(thread.id);
  assert.match(opening!.body, /counts the first attempt/);
  assert.match(opening!.body, /QA would test[\s\S]*three times → Two retries/);
  assert.match(
    opening!.body,
    /implementer would build[\s\S]*two attempts in total/,
  );
  assert.match(opening!.body, /one model/);
  const summary = threads.find((t) => t.id !== thread.id)!;
  assert.match(
    (await pr.messages(summary.id)).at(-1)!.body,
    /Two readings:\*\* 2 of 2 changed acceptance criteria read, 1 with diverging/,
  );

  // A new commit rewords the other criterion. The divergence on the same
  // text continues its discussion even when the model does not link it.
  await pr.commit(
    [
      "Retry the payment when the provider times out.",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] A timed-out payment is retried **at most twice**.",
      "- [ ] The customer is charged exactly once.",
    ].join("\n"),
  );
  await processAiRuns(db, {
    analyzer: fakeAnalyzer(
      [],
      () => [],
      () => [diverge("A1"), agree("A2")],
    ),
  });
  threads = await pr.threads();
  assert.equal(
    threads.length,
    2,
    "no second discussion for the same criterion",
  );
  const replies = await pr.messages(thread.id);
  assert.equal(replies.length, 2);
  assert.match(replies[1]!.body, /^Still diverges at commit/);
  assert.match(replies[1]!.body, /QA would test/);
  assert.equal(threads.find((t) => t.id === thread.id)!.status, "open");
  assert.equal((await f.runs(f.storyId))[0]!.findings[0]!.threadId, thread.id);

  // Advisory: the open divergence never stands between people and a merge.
  await pr.merge();
});

void test("two readings under the required policy: agreement adds nothing and a divergence never blocks", async () => {
  const f = await fixture();
  const pr = await criteriaPullRequest(f, "required");
  await processAiRuns(db, {
    analyzer: fakeAnalyzer(
      [],
      () => [],
      () => [agree("A1"), agree("A2")],
    ),
  });
  let threads = await pr.threads();
  assert.equal(threads.length, 1, "only the summary");
  assert.equal((await f.runs(f.storyId))[0]!.findings.length, 0);

  await pr.commit(
    "## Acceptance criteria\n\n- [ ] A timed-out payment is retried at most twice.",
  );
  await processAiRuns(db, {
    analyzer: fakeAnalyzer(
      [],
      () => [],
      () => [
        // Even a model that calls it a blocker gets at most "major".
        { ...diverge("A1"), severity: "blocker" as "major" },
      ],
    ),
  });
  const [run] = await f.runs(f.storyId);
  assert.equal(run!.findings[0]!.severity, "major");
  threads = await pr.threads();
  assert.equal(threads.length, 2);
  assert.ok(threads.every((t) => !t.blocking));
  await pr.merge();
});

void test("two readings: a divergence on the second of two identical criteria anchors to the second copy", async () => {
  const f = await fixture();
  const pr = await criteriaPullRequest(f, "advisory");
  const repeated = "The customer sees one charge.";
  await pr.commit(
    [
      "## Acceptance criteria",
      "",
      `- [ ] ${repeated}`,
      "- [ ] A timed-out payment is retried at most twice.",
      `- [ ] ${repeated}`,
    ].join("\n"),
  );
  await processAiRuns(db, {
    analyzer: fakeAnalyzer(
      [],
      () => [],
      (context) => {
        assert.deepEqual(
          context.acceptanceCriteria.map((c) => c.text),
          [repeated, "A timed-out payment is retried at most twice.", repeated],
        );
        return [agree("A1"), agree("A2"), diverge("A3")];
      },
    ),
  });
  const [run] = await f.runs(f.storyId);
  const thread = (await pr.threads()).find(
    (t) => t.id === run!.findings[0]!.threadId,
  )!;
  assert.deepEqual(thread.anchor, {
    version: 1,
    kind: "document",
    section: "Acceptance criteria",
    quote: repeated,
    occurrence: 1,
  });
  const { head } = await pr.heads();
  const model = textModel(parseMarkdownTree(head.content));
  const placed = placeQuote(model, thread.anchor);
  assert.equal(placed.kind, "found");
  assert.equal(
    placed.kind === "found" && placed.from,
    model.text.lastIndexOf(repeated),
    "the discussion sits on the second copy",
  );
});
