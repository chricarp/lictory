import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import {
  PROTOCOL,
  type Command,
  type SpaceEntityOf,
} from "@lictory/core/contracts/protocol";
import { DomainError } from "@lictory/core/domain/errors";
import { seedOrganization } from "@lictory/core/domain/organization";
import { projectionDrift } from "@lictory/core/domain/projection-reader.test-helper";
import { executeMutation } from "@lictory/core/domain/service";
import {
  describeDiscussions,
  discussionCounts,
  discussionsOfDeletedBranch,
  discussionsOfMerge,
  onDeletedLine,
  type LineThread,
} from "@lictory/core/spaces/discussion-lifecycle";
import { removeOrphanedPageDiscussions } from "@lictory/core/spaces/discussions";

// Discussions end with their line (docs/internals/spaces.md#when-a-line-ends):
// deleting a branch or merging a pull request removes the discussions of the
// line that ends, whatever their state, and nothing else; refused or
// repeated operations remove nothing. Against a real, disposable database.

// ------------------------------------------------------------- selection

const t = (id: string, line: Partial<LineThread> = {}): LineThread => ({
  id,
  status: "open",
  blocking: false,
  branchId: null,
  pullRequestId: null,
  pullRequestSourceBranchId: null,
  ...line,
});
const ids = (threads: LineThread[]) => threads.map((x) => x.id).sort();

void test("a deleted branch takes its own discussions and branchless ones of pull requests from it", () => {
  const threads = [
    t("on-source", { branchId: "S" }),
    t("on-source-pr", {
      branchId: "S",
      pullRequestId: "P",
      pullRequestSourceBranchId: "S",
    }),
    t("pr-only", { pullRequestId: "P", pullRequestSourceBranchId: "S" }),
    // Written on the pull request but explicitly on its target.
    t("pr-on-target", {
      branchId: "T",
      pullRequestId: "P",
      pullRequestSourceBranchId: "S",
    }),
    t("on-target", { branchId: "T" }),
    t("whole-page"),
    t("on-commit", { branchId: null }),
  ];
  assert.deepEqual(ids(discussionsOfDeletedBranch(threads, "S")), [
    "on-source",
    "on-source-pr",
    "pr-only",
  ]);
  const live = new Set(["T"]);
  assert.deepEqual(ids(threads.filter((x) => onDeletedLine(x, live))), [
    "on-source",
    "on-source-pr",
    "pr-only",
  ]);
});

void test("a merge takes its source's discussions and its own, never another line's", () => {
  const threads = [
    t("on-source", { branchId: "S" }),
    t("pr-only", { pullRequestId: "P", pullRequestSourceBranchId: "S" }),
    t("pr-on-target", {
      branchId: "T",
      pullRequestId: "P",
      pullRequestSourceBranchId: "S",
    }),
    // On the source but for another pull request that still uses it.
    t("other-pr-on-source", {
      branchId: "S",
      pullRequestId: "Q",
      pullRequestSourceBranchId: "S",
    }),
    t("other-pr-only", {
      pullRequestId: "Q",
      pullRequestSourceBranchId: "S",
    }),
    t("on-target", { branchId: "T" }),
    t("whole-page"),
  ];
  const pr = { id: "P", sourceBranchId: "S" };
  assert.deepEqual(ids(discussionsOfMerge(threads, pr, false)), [
    "on-source",
    "pr-only",
  ]);
  // Retiring the source takes everything on it, as deleting it would.
  assert.deepEqual(
    ids(discussionsOfMerge(threads, pr, true)),
    ["other-pr-on-source", "other-pr-only", "on-source", "pr-only"].sort(),
  );
});

void test("counts and their English summary cover every state", () => {
  const threads = [
    t("a"),
    t("b", { blocking: true }),
    t("c", { status: "resolved" }),
    t("d", { status: "resolved", blocking: true }),
  ];
  const counts = discussionCounts(threads);
  assert.deepEqual(counts, {
    open: 2,
    openBlocking: 1,
    resolved: 2,
    resolvedBlocking: 1,
  });
  assert.equal(
    describeDiscussions(counts),
    "4 discussions (2 open, 1 of them blocking; 2 resolved, 1 of them blocking)",
  );
  assert.equal(
    describeDiscussions(discussionCounts([t("x", { blocking: true })])),
    "1 discussion (1 open, blocking)",
  );
  assert.equal(describeDiscussions(discussionCounts([])), "no discussions");
});

// -------------------------------------------------------------- database

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_discussion_lifecycle_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
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

async function user(name: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({
    id,
    name,
    email: `${id}@example.test`,
    emailVerified: true,
  });
  return id;
}

type Summary = Record<string, string>;

// An organization with a Direct space: owner and alice edit, carol comments.
async function fixture() {
  const organizationId = crypto.randomUUID();
  const [owner, alice, carol] = await Promise.all(
    ["Owner", "Alice", "Carol"].map(user),
  );
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: organizationId,
    createdAt: new Date(),
  });
  for (const [userId, role] of [
    [owner!, "owner"],
    [alice!, "member"],
    [carol!, "member"],
  ] as const)
    await db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role,
      createdAt: new Date(),
    });
  await seedOrganization(db, organizationId);
  const run = async (actor: string, command: Command) =>
    (
      await executeMutation(
        db,
        { userId: actor },
        {
          protocol: PROTOCOL,
          id: crypto.randomUUID(),
          organizationId,
          command,
        },
      )
    ).summary as Summary | undefined;
  const projectId = crypto.randomUUID();
  await run(owner!, {
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
  });
  await run(owner!, {
    type: "setProjectMember",
    projectId,
    userId: alice!,
    role: "member",
  });
  const spaceId = crypto.randomUUID();
  await run(owner!, {
    type: "createSpace",
    spaceId,
    name: "Handbook",
    slug: `space-${spaceId.slice(0, 8)}`,
    home: { projectId },
  });
  await run(owner!, {
    type: "setSpaceGrant",
    spaceId,
    userId: carol!,
    level: "comment",
  });
  const { pageId, mainBranchId } = (await run(alice!, {
    type: "createPage",
    spaceId,
    pageId: crypto.randomUUID(),
    title: "Retries",
  })) as { pageId: string; mainBranchId: string };
  // A branch with a commit and an open pull request into main.
  const propose = async (markdown: string) => {
    const summary = (await run(alice!, {
      type: "proposePageChange",
      pageId,
      branchId: crypto.randomUUID(),
      pullRequestId: crypto.randomUUID(),
      title: "Retries",
      markdown,
      message: "Change the retry policy",
    }))!;
    return {
      branchId: summary.branchId!,
      pullRequestId: summary.pullRequestId!,
    };
  };
  const branch = async (name: string) => {
    const branchId = crypto.randomUUID();
    await run(alice!, { type: "createPageBranch", pageId, branchId, name });
    return branchId;
  };
  const thread = async (
    options: {
      branchId?: string;
      pullRequestId?: string;
      blocking?: boolean;
      resolved?: boolean;
    } = {},
  ) => {
    const threadId = crypto.randomUUID();
    await run(carol!, {
      type: "createPageThread",
      pageId,
      threadId,
      messageId: crypto.randomUUID(),
      anchor: { v: 1, kind: "page" },
      body: "What happens on timeout?",
      blocking: options.blocking ?? false,
      ...(options.branchId ? { branchId: options.branchId } : {}),
      ...(options.pullRequestId
        ? { pullRequestId: options.pullRequestId }
        : {}),
    });
    await run(alice!, {
      type: "replyToPageThread",
      threadId,
      messageId: crypto.randomUUID(),
      body: "Answered below.",
    });
    if (options.resolved)
      await run(alice!, { type: "resolvePageThread", threadId });
    return threadId;
  };
  // One thread in each state: open or resolved, blocking or not.
  const everyState = async (line: {
    branchId?: string;
    pullRequestId?: string;
  }) => [
    await thread({ ...line }),
    await thread({ ...line, blocking: true }),
    await thread({ ...line, resolved: true }),
    await thread({ ...line, blocking: true, resolved: true }),
  ];
  const heads = async (pullRequestId: string) => {
    const pr = await projection<SpaceEntityOf<"pagePullRequest">>(
      `pagePullRequest:${pullRequestId}`,
    );
    return {
      inspectedSourceHead: pr!.mergeability!.sourceHeadId,
      inspectedTargetHead: pr!.mergeability!.targetHeadId,
    };
  };
  return {
    organizationId,
    owner: owner!,
    alice: alice!,
    carol: carol!,
    pageId,
    mainBranchId,
    run,
    propose,
    branch,
    thread,
    everyState,
    heads,
  };
}

async function rejects(
  promise: Promise<unknown>,
  category: DomainError["category"],
  message?: RegExp,
) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DomainError, String(error));
    assert.equal(error.category, category, error.message);
    if (message) assert.match(error.message, message);
    return true;
  });
}

const projection = async <T>(key: string) =>
  (
    await db
      .select({ data: s.spaceEntity.data })
      .from(s.spaceEntity)
      .where(eq(s.spaceEntity.key, key))
  )[0]?.data as T | undefined;

// Which of `threadIds` still exist, in the domain and in the projections
// browsers receive (threads and their messages).
async function remaining(threadIds: string[]) {
  const rows = await db
    .select({ id: s.pageThread.id })
    .from(s.pageThread)
    .where(inArray(s.pageThread.id, threadIds));
  const messages = await db
    .select({ threadId: s.pageThreadMessage.threadId })
    .from(s.pageThreadMessage)
    .where(inArray(s.pageThreadMessage.threadId, threadIds));
  const projected = await db
    .select({ key: s.spaceEntity.key })
    .from(s.spaceEntity)
    .where(
      inArray(
        s.spaceEntity.key,
        threadIds.map((id) => `pageThread:${id}`),
      ),
    );
  const projectedMessages = (
    await db
      .select({ data: s.spaceEntity.data })
      .from(s.spaceEntity)
      .where(eq(s.spaceEntity.type, "pageThreadMessage"))
  ).filter((r) => threadIds.includes(r.data.threadId as string));
  // The domain and the projection agree.
  assert.deepEqual(
    projected.map((r) => r.key.slice("pageThread:".length)).sort(),
    rows.map((r) => r.id).sort(),
  );
  assert.deepEqual(
    [
      ...new Set(projectedMessages.map((r) => r.data.threadId as string)),
    ].sort(),
    [...new Set(messages.map((m) => m.threadId))].sort(),
  );
  return rows.map((r) => r.id).sort();
}

const removals = async (pageId: string) =>
  (
    await db
      .select({
        actorId: s.pageActivity.actorId,
        detail: s.pageActivity.detail,
      })
      .from(s.pageActivity)
      .where(
        and(
          eq(s.pageActivity.pageId, pageId),
          eq(s.pageActivity.action, "discussions_removed"),
        ),
      )
      .orderBy(s.pageActivity.createdAt)
  ).map((r) => ({ actorId: r.actorId, ...r.detail }));

const summaryOf = (pageId: string) =>
  projection<SpaceEntityOf<"page">>(`page:${pageId}`);

void test(
  "deleting a branch removes every discussion on it, whatever its state, after warning with the same counts",
  { timeout: 30_000 },
  async () => {
    const f = await fixture();
    const { branchId, pullRequestId } = await f.propose("Retry **once**.");
    const other = await f.branch("other");
    const doomed = await f.everyState({ branchId });
    // Branchless discussions of a closed pull request from the branch.
    const prOnly = await f.thread({ pullRequestId, blocking: true });
    const kept = [
      await f.thread({ branchId: f.mainBranchId, blocking: true }),
      await f.thread({ branchId: other, resolved: true }),
      await f.thread(),
    ];
    await f.run(f.alice, { type: "deletePagePullRequest", pullRequestId });

    const shown = await projection<SpaceEntityOf<"pageBranch">>(
      `pageBranch:${branchId}`,
    );
    // Closing resolved the pull request's own discussion.
    assert.deepEqual(shown?.discussionsOnDelete, {
      open: 2,
      openBlocking: 1,
      resolved: 3,
      resolvedBlocking: 2,
    });
    assert.equal(
      (
        await projection<SpaceEntityOf<"pageBranch">>(
          `pageBranch:${f.mainBranchId}`,
        )
      )?.discussionsOnDelete,
      undefined,
    );

    // Without a confirmation (a client from before the warning) nothing is
    // removed.
    await rejects(
      f.run(f.alice, { type: "deletePageBranch", branchId }),
      "conflict",
      /Confirm the deletion first: .* discussionsToRemove: 5\./,
    );
    // Confirming outdated counts removes nothing.
    await rejects(
      f.run(f.alice, {
        type: "deletePageBranch",
        branchId,
        discussionsToRemove: 4,
      }),
      "conflict",
      /changed since you confirmed: it now removes 5 discussions/,
    );
    assert.equal((await remaining([...doomed, prOnly])).length, 5);

    await f.run(f.alice, {
      type: "deletePageBranch",
      branchId,
      discussionsToRemove: 5,
    });
    assert.deepEqual(await remaining([...doomed, prOnly]), []);
    assert.deepEqual(await remaining(kept), [...kept].sort());
    const [removal] = await removals(f.pageId);
    assert.equal(removal?.actorId, f.alice);
    assert.equal(removal?.reason, "branch_deleted");
    assert.equal(removal?.branchId, branchId);
    assert.deepEqual(
      (removal?.threadIds as string[]).sort(),
      [...doomed, prOnly].sort(),
    );
    assert.equal(removal?.messages, 10);
    // The page's counters no longer count them.
    const summary = await summaryOf(f.pageId);
    assert.deepEqual([summary?.openThreads, summary?.blockingThreads], [2, 1]);

    // Deleting again changes nothing.
    await f.run(f.alice, { type: "deletePageBranch", branchId });
    assert.equal((await removals(f.pageId)).length, 1);
    assert.deepEqual(await remaining(kept), [...kept].sort());
    assert.deepEqual(await projectionDrift(db, f.organizationId), []);
  },
);

void test(
  "merging into main removes the source's and the pull request's discussions and keeps every other line's",
  { timeout: 30_000 },
  async () => {
    const f = await fixture();
    const { branchId, pullRequestId } = await f.propose("Retry **once**.");
    const other = await f.branch("other");
    const onSource = await f.everyState({ branchId });
    const onPullRequest = [
      await f.thread({ pullRequestId, resolved: true }),
      await f.thread({ pullRequestId }),
    ];
    const kept = [
      await f.thread({ branchId: f.mainBranchId, resolved: true }),
      await f.thread({ branchId: other }),
      await f.thread({ branchId: other, blocking: true, resolved: true }),
      // Written on the pull request but about the target.
      await f.thread({ branchId: f.mainBranchId, pullRequestId }),
      await f.thread(),
    ];
    const doomed = [...onSource, ...onPullRequest];

    // An open blocking discussion on the source holds the merge, and the
    // refused merge removes nothing.
    const heads = await f.heads(pullRequestId);
    await rejects(
      f.run(f.owner, { type: "mergePagePullRequest", pullRequestId, ...heads }),
      "conflict",
      /A blocking discussion is still open/,
    );
    assert.equal((await remaining(doomed)).length, doomed.length);
    await f.run(f.alice, { type: "resolvePageThread", threadId: onSource[1]! });

    const pr = await projection<SpaceEntityOf<"pagePullRequest">>(
      `pagePullRequest:${pullRequestId}`,
    );
    assert.deepEqual(pr?.mergeability?.blockers, []);
    assert.deepEqual(pr?.mergeability?.onMerge, {
      sourceRetired: true,
      discussions: {
        open: 2,
        openBlocking: 0,
        resolved: 4,
        resolvedBlocking: 2,
      },
    });

    // An unconfirmed or stale confirmation is refused before anything
    // changes.
    await rejects(
      f.run(f.owner, { type: "mergePagePullRequest", pullRequestId, ...heads }),
      "conflict",
      /This permanently deletes 6 discussions/,
    );
    await rejects(
      f.run(f.owner, {
        type: "mergePagePullRequest",
        pullRequestId,
        ...heads,
        discussionsToRemove: 5,
      }),
      "conflict",
      /Review the warning and confirm again/,
    );
    // Told the source would stay, the person never agreed to its deletion.
    await rejects(
      f.run(f.owner, {
        type: "mergePagePullRequest",
        pullRequestId,
        ...heads,
        discussionsToRemove: 6,
        deletesSourceBranch: false,
      }),
      "conflict",
      /Merging now deletes branch .*, unlike what you confirmed/,
    );
    assert.equal((await remaining(doomed)).length, doomed.length);

    await f.run(f.owner, {
      type: "mergePagePullRequest",
      pullRequestId,
      ...heads,
      discussionsToRemove: 6,
      deletesSourceBranch: true,
    });
    assert.deepEqual(await remaining(doomed), []);
    assert.deepEqual(await remaining(kept), [...kept].sort());
    const [removal] = await removals(f.pageId);
    assert.equal(removal?.reason, "pull_request_merged");
    assert.equal(removal?.pullRequestId, pullRequestId);
    assert.equal(removal?.sourceRetired, true);
    assert.equal(removal?.actorId, f.owner);
    const [source] = await db
      .select({ deletedAt: s.pageBranch.deletedAt })
      .from(s.pageBranch)
      .where(eq(s.pageBranch.id, branchId));
    assert.ok(source?.deletedAt, "the merge retired the source");

    // Repeating the merge is refused and removes nothing more; a merged pull
    // request takes no new discussions.
    await rejects(
      f.run(f.owner, { type: "mergePagePullRequest", pullRequestId, ...heads }),
      "conflict",
      /already merged/,
    );
    await rejects(
      f.thread({ pullRequestId }),
      "conflict",
      /This pull request is merged/,
    );
    assert.equal((await removals(f.pageId)).length, 1);
    assert.deepEqual(await remaining(kept), [...kept].sort());
    const summary = await summaryOf(f.pageId);
    assert.deepEqual([summary?.openThreads, summary?.blockingThreads], [3, 0]);
    assert.deepEqual(await projectionDrift(db, f.organizationId), []);
  },
);

void test(
  "merging into another branch removes the source's discussions while the source stays, and its blockers hold the merge",
  { timeout: 30_000 },
  async () => {
    const f = await fixture();
    const { branchId: source, pullRequestId: intoMain } =
      await f.propose("Retry **once**.");
    const target = await f.branch("release");
    const pullRequestId = crypto.randomUUID();
    await f.run(f.alice, {
      type: "createPagePullRequest",
      pageId: f.pageId,
      pullRequestId,
      sourceBranchId: source,
      targetBranchId: target,
      title: "Into release",
    });
    const onSource = await f.everyState({ branchId: source });
    // The source's other pull request (into main) keeps its discussions.
    const forOtherPullRequest = [
      await f.thread({ branchId: source, pullRequestId: intoMain }),
      await f.thread({ pullRequestId: intoMain, resolved: true }),
    ];
    const onTarget = await f.everyState({ branchId: target });

    const heads = await f.heads(pullRequestId);
    // Before, only the pull request's own blockers held a merge into a
    // branch; the source's would now be deleted with it.
    await rejects(
      f.run(f.alice, { type: "mergePagePullRequest", pullRequestId, ...heads }),
      "conflict",
      /on this pull request or/,
    );
    await f.run(f.alice, { type: "resolvePageThread", threadId: onSource[1]! });
    const pr = await projection<SpaceEntityOf<"pagePullRequest">>(
      `pagePullRequest:${pullRequestId}`,
    );
    assert.deepEqual(pr?.mergeability?.onMerge, {
      sourceRetired: false,
      discussions: {
        open: 1,
        openBlocking: 0,
        resolved: 3,
        resolvedBlocking: 2,
      },
    });
    await f.run(f.alice, {
      type: "mergePagePullRequest",
      pullRequestId,
      ...heads,
      discussionsToRemove: 4,
    });
    assert.deepEqual(await remaining(onSource), []);
    assert.deepEqual(
      await remaining([...forOtherPullRequest, ...onTarget]),
      [...forOtherPullRequest, ...onTarget].sort(),
    );
    const [branch] = await db
      .select({ deletedAt: s.pageBranch.deletedAt })
      .from(s.pageBranch)
      .where(eq(s.pageBranch.id, source));
    assert.equal(branch?.deletedAt, null, "the source stays");
    const [removal] = await removals(f.pageId);
    assert.equal(removal?.sourceRetired, false);
    assert.deepEqual(await projectionDrift(db, f.organizationId), []);
  },
);

void test(
  "discussions left on branches deleted earlier block nothing and are repaired once",
  { timeout: 30_000 },
  async () => {
    const f = await fixture();
    const { branchId, pullRequestId } = await f.propose("Retry **once**.");
    const orphans = [
      ...(await f.everyState({ branchId })),
      await f.thread({ pullRequestId, blocking: true }),
    ];
    const kept = [await f.thread({ branchId: f.mainBranchId })];
    // Older versions deleted a branch (after closing its pull request) and
    // kept its discussions.
    await f.run(f.alice, { type: "deletePagePullRequest", pullRequestId });
    await f.run(f.alice, {
      type: "reopenPageThread",
      threadId: orphans[4]!,
    });
    await db
      .update(s.pageBranch)
      .set({ deletedAt: new Date(), deletedById: f.alice })
      .where(eq(s.pageBranch.id, branchId));

    // They hold no merge into main.
    const next = await f.propose("Retry **twice**.");
    const pr = await projection<SpaceEntityOf<"pagePullRequest">>(
      `pagePullRequest:${next.pullRequestId}`,
    );
    assert.deepEqual(pr?.mergeability?.blockers, []);

    assert.deepEqual(
      await removeOrphanedPageDiscussions(db, f.organizationId, {
        dryRun: true,
      }),
      { pages: 1, threads: 5, messages: 0 },
    );
    assert.equal((await remaining(orphans)).length, 5);

    assert.deepEqual(
      await removeOrphanedPageDiscussions(db, f.organizationId),
      {
        pages: 1,
        threads: 5,
        messages: 10,
      },
    );
    assert.deepEqual(await remaining(orphans), []);
    assert.deepEqual(await remaining(kept), kept);
    const [removal] = await removals(f.pageId);
    assert.equal(removal?.actorId, f.alice, "attributed to who deleted it");
    assert.equal(removal?.repair, true);
    assert.equal(removal?.branchId, branchId);
    assert.deepEqual(await projectionDrift(db, f.organizationId), []);

    // A second run finds nothing.
    assert.deepEqual(
      await removeOrphanedPageDiscussions(db, f.organizationId),
      {
        pages: 0,
        threads: 0,
        messages: 0,
      },
    );
    assert.equal((await removals(f.pageId)).length, 1);

    // Branch rows projected before the counts existed get them from the
    // rollout, so their confirmations can be answered.
    const live = await f.branch("live");
    await db
      .update(s.spaceEntity)
      .set({
        data: sql`${s.spaceEntity.data} - 'discussionsOnDelete'`,
      })
      .where(eq(s.spaceEntity.key, `pageBranch:${live}`));
    assert.notEqual(
      (await projectionDrift(db, f.organizationId)).length,
      0,
      "the old row lacks the counts",
    );
    await removeOrphanedPageDiscussions(db, f.organizationId);
    assert.deepEqual(
      (await projection<SpaceEntityOf<"pageBranch">>(`pageBranch:${live}`))
        ?.discussionsOnDelete,
      { open: 0, openBlocking: 0, resolved: 0, resolvedBlocking: 0 },
    );
    assert.deepEqual(await projectionDrift(db, f.organizationId), []);
  },
);
