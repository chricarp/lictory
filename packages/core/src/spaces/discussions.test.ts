import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import {
  PROTOCOL,
  pageThreadAnchorSchema,
  type Command,
  type PageThreadAnchor,
  type SpaceEntityOf,
} from "@lictory/core/contracts/protocol";
import {
  CapabilityError,
  noEffects,
  type CapabilityContext,
} from "@lictory/core/capabilities/core";
import { invoke } from "@lictory/core/capabilities/registry";
import { DomainError } from "@lictory/core/domain/errors";
import { seedOrganization } from "@lictory/core/domain/organization";
import { projectionDrift } from "@lictory/core/domain/projection-reader.test-helper";
import { executeMutation } from "@lictory/core/domain/service";
import { dispatchNotificationEmails } from "@lictory/core/notifications/email";
import { mentionToken } from "@lictory/core/notifications/mentions";
import { createNotificationService } from "@lictory/core/notifications/service";
import { notifyPageReviewRequested } from "@lictory/core/spaces/notifications";
import type { ObjectStorage } from "@lictory/core/storage/s3";

// Page discussions, Spaces notifications and page files against a real,
// disposable PostgreSQL database (docs/internals/spaces.md#comments).

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_page_discussions_test_${crypto.randomUUID().replaceAll("-", "")}`;
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

// An organization with a project whose space everyone reads:
// - owner: organization owner and project administrator (edits);
// - alice: project member (edits);
// - carol: organization member with a comment grant;
// - dave: organization member (views).
async function fixture() {
  const organizationId = crypto.randomUUID();
  const [owner, alice, carol, dave] = await Promise.all(
    ["Owner", "Alice", "Carol", "Dave"].map(user),
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
    [dave!, "member"],
  ] as const)
    await db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role,
      createdAt: new Date(),
    });
  await seedOrganization(db, organizationId);
  const run = (actor: string, command: Command, id = crypto.randomUUID()) =>
    executeMutation(
      db,
      { userId: actor },
      { protocol: PROTOCOL, id, organizationId, command },
    );
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
  const space = async (
    options: Partial<Extract<Command, { type: "createSpace" }>> = {},
  ) => {
    const spaceId = crypto.randomUUID();
    await run(owner!, {
      type: "createSpace",
      spaceId,
      name: "Handbook",
      slug: `space-${spaceId.slice(0, 8)}`,
      home: { projectId },
      ...options,
    });
    return spaceId;
  };
  const page = async (actor: string, spaceId: string) => {
    const result = await run(actor, {
      type: "createPage",
      spaceId,
      pageId: crypto.randomUUID(),
      title: "Retries",
    });
    return result.summary as {
      pageId: string;
      mainBranchId: string;
      commitId: string;
      draftId?: string;
    };
  };
  const spaceId = await space();
  await run(owner!, {
    type: "setSpaceGrant",
    spaceId,
    userId: carol!,
    level: "comment",
  });
  const thread = async (
    actor: string,
    pageId: string,
    options: Partial<Extract<Command, { type: "createPageThread" }>> = {},
  ) => {
    const threadId = crypto.randomUUID();
    await run(actor, {
      type: "createPageThread",
      pageId,
      threadId,
      messageId: crypto.randomUUID(),
      anchor: { v: 1, kind: "page" },
      body: "What happens on timeout?",
      ...options,
    });
    return threadId;
  };
  return {
    organizationId,
    owner: owner!,
    alice: alice!,
    carol: carol!,
    dave: dave!,
    projectId,
    spaceId,
    run,
    space,
    page,
    thread,
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

const notificationsOf = (userId: string, organizationId: string) =>
  db
    .select()
    .from(s.notification)
    .where(
      and(
        eq(s.notification.userId, userId),
        eq(s.notification.organizationId, organizationId),
      ),
    );

void test("anchors have a versioned, bounded shape", () => {
  const valid: PageThreadAnchor[] = [
    { v: 1, kind: "page" },
    {
      v: 1,
      kind: "commit",
      commitId: "c1",
      blockId: "block-1",
      from: 0,
      to: 5,
      quote: "Retry",
    },
    {
      v: 1,
      kind: "draft",
      draftId: "d1",
      epoch: 1,
      start: "AQIDBA==",
      end: "AQIDBQ==",
      quote: "Retry",
    },
  ];
  for (const anchor of valid)
    assert.ok(pageThreadAnchorSchema.safeParse(anchor).success);
  for (const anchor of [
    { v: 2, kind: "page" },
    { v: 1, kind: "page", extra: true },
    { ...valid[1], from: 5, to: 5 },
    { ...valid[1], blockId: "not a block id" },
    { ...valid[1], quote: "" },
    { ...valid[1], quote: "x".repeat(2001) },
    { ...valid[2], start: "not base64!" },
    { ...valid[2], epoch: 0 },
  ])
    assert.equal(
      pageThreadAnchorSchema.safeParse(anchor).success,
      false,
      JSON.stringify(anchor).slice(0, 80),
    );
});

void test("commenting needs comment access to an active page; others are refused without learning more", async () => {
  const f = await fixture();
  const { pageId } = await f.page(f.alice, f.spaceId);
  // View access reads but cannot comment.
  await rejects(f.thread(f.dave, pageId), "forbidden", /comment access/);
  // Comment and edit access can.
  const threadId = await f.thread(f.carol, pageId);
  await f.thread(f.alice, pageId);
  await f.run(f.alice, {
    type: "replyToPageThread",
    threadId,
    messageId: crypto.randomUUID(),
    body: "It retries once.",
  });
  await rejects(
    f.run(f.dave, {
      type: "replyToPageThread",
      threadId,
      messageId: crypto.randomUUID(),
      body: "Me too",
    }),
    "forbidden",
  );
  await rejects(
    f.run(f.dave, { type: "resolvePageThread", threadId }),
    "forbidden",
  );
  // Any commenter resolves, reopens and marks blocking (as on
  // specifications).
  await f.run(f.carol, {
    type: "setPageThreadBlocking",
    threadId,
    blocking: true,
  });
  await f.run(f.alice, { type: "resolvePageThread", threadId });

  // A restricted space: outsiders cannot tell the page or thread exists.
  const restricted = await f.space({ accessMode: "restricted" });
  const hidden = await f.page(f.owner, restricted);
  const hiddenThread = await f.thread(f.owner, hidden.pageId);
  await rejects(f.thread(f.alice, hidden.pageId), "not_found", /page/);
  await rejects(
    f.run(f.alice, { type: "reopenPageThread", threadId: hiddenThread }),
    "not_found",
    /discussion is unavailable/,
  );
  await assert.rejects(
    invoke(
      {
        db,
        principal: { userId: f.alice, surface: "mcp" },
        effects: noEffects,
      },
      "listPageThreads",
      { organizationId: f.organizationId, pageId: hidden.pageId },
    ),
    (error) =>
      error instanceof CapabilityError && error.category === "not_found",
  );

  // Archived pages are read-only.
  await f.run(f.alice, { type: "archivePage", pageId, archived: true });
  await rejects(f.thread(f.alice, pageId), "conflict", /archived/);
  await rejects(
    f.run(f.alice, { type: "reopenPageThread", threadId }),
    "conflict",
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("identifiers from another organization or page are refused", async () => {
  const f = await fixture();
  const g = await fixture();
  const { pageId } = await f.page(f.alice, f.spaceId);
  const other = await f.page(f.alice, f.spaceId);
  const threadId = await f.thread(f.alice, pageId);
  // g's owner names f's page and thread inside g.
  await rejects(g.thread(g.owner, pageId), "not_found");
  await rejects(
    g.run(g.owner, {
      type: "replyToPageThread",
      threadId,
      messageId: crypto.randomUUID(),
      body: "Hello",
    }),
    "not_found",
  );
  // A thread id already used anywhere is refused.
  const gPage = await g.page(g.alice, g.spaceId);
  await rejects(
    g.thread(g.alice, gPage.pageId, { threadId }),
    "conflict",
    /already used/,
  );
  // A commit, branch or draft of another page is not this page's.
  await rejects(
    f.thread(f.alice, pageId, {
      anchor: {
        v: 1,
        kind: "commit",
        commitId: other.commitId,
        blockId: "b1",
        from: 0,
        to: 1,
        quote: "R",
      },
    }),
    "not_found",
    /version/,
  );
  await rejects(
    f.thread(f.alice, pageId, { branchId: other.mainBranchId }),
    "not_found",
    /branch/,
  );
  await rejects(
    f.thread(f.alice, pageId, {
      anchor: {
        v: 1,
        kind: "draft",
        draftId: other.draftId!,
        epoch: 1,
        start: "AQIDBA==",
        end: "AQIDBQ==",
        quote: "R",
      },
    }),
    "not_found",
    /draft/,
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
  assert.deepEqual(await projectionDrift(db, g.organizationId), []);
});

void test("commit and draft anchors are checked against the page and the draft's current epoch", async () => {
  const f = await fixture();
  const created = await f.page(f.alice, f.spaceId);
  const commitThread = await f.thread(f.carol, created.pageId, {
    anchor: {
      v: 1,
      kind: "commit",
      commitId: created.commitId,
      blockId: "b1",
      from: 2,
      to: 9,
      quote: "retries",
    },
  });
  const draftAnchor = {
    v: 1,
    kind: "draft",
    draftId: created.draftId!,
    epoch: 1,
    start: "AQIDBA==",
    end: "AQIDBQ==",
    quote: "timeout",
  } as const;
  const draftThread = await f.thread(f.carol, created.pageId, {
    anchor: draftAnchor,
  });
  const rows = await db
    .select()
    .from(s.pageThread)
    .where(eq(s.pageThread.pageId, created.pageId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get(commitThread)?.commitId, created.commitId);
  // A draft thread belongs to the draft's line.
  assert.equal(byId.get(draftThread)?.branchId, created.mainBranchId);
  assert.deepEqual(byId.get(draftThread)?.anchor, draftAnchor);
  await rejects(
    f.thread(f.carol, created.pageId, {
      anchor: { ...draftAnchor, epoch: 2 },
    }),
    "conflict",
    /replaced/,
  );
  // Requiring reviews closes main's draft: it takes no new anchors.
  await f.run(f.owner, {
    type: "updateSpace",
    spaceId: f.spaceId,
    publishing: "reviewed",
  });
  await rejects(
    f.thread(f.carol, created.pageId, { anchor: draftAnchor }),
    "conflict",
    /closed/,
  );
  // The database refuses an anchor that disagrees with its columns.
  await assert.rejects(
    db.insert(s.pageThread).values({
      organizationId: f.organizationId,
      pageId: created.pageId,
      authorId: f.alice,
      anchor: { v: 1, kind: "commit", commitId: created.commitId },
    }),
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("resolving and reopening keep every message and record who did it; counters follow open and blocking threads", async () => {
  const f = await fixture();
  const { pageId } = await f.page(f.alice, f.spaceId);
  const summary = () => projection<SpaceEntityOf<"page">>(`page:${pageId}`);
  assert.deepEqual(
    [(await summary())?.openThreads, (await summary())?.blockingThreads],
    [0, 0],
  );
  const blocking = await f.thread(f.carol, pageId, { blocking: true });
  const plain = await f.thread(f.alice, pageId);
  await f.run(f.alice, {
    type: "replyToPageThread",
    threadId: blocking,
    messageId: crypto.randomUUID(),
    body: "Fixed in the next commit.",
  });
  assert.deepEqual(
    [(await summary())?.openThreads, (await summary())?.blockingThreads],
    [2, 1],
  );
  await f.run(f.alice, { type: "resolvePageThread", threadId: blocking });
  // Resolving again changes nothing.
  await f.run(f.alice, { type: "resolvePageThread", threadId: blocking });
  assert.deepEqual(
    [(await summary())?.openThreads, (await summary())?.blockingThreads],
    [1, 0],
  );
  const thread = await projection<SpaceEntityOf<"pageThread">>(
    `pageThread:${blocking}`,
  );
  assert.equal(thread?.status, "resolved");
  assert.equal(thread?.resolvedById, f.alice);
  const messages = await db
    .select()
    .from(s.pageThreadMessage)
    .where(eq(s.pageThreadMessage.threadId, blocking));
  assert.equal(messages.length, 2);

  await f.run(f.carol, { type: "reopenPageThread", threadId: blocking });
  await f.run(f.carol, {
    type: "setPageThreadBlocking",
    threadId: plain,
    blocking: true,
  });
  assert.deepEqual(
    [(await summary())?.openThreads, (await summary())?.blockingThreads],
    [2, 2],
  );
  assert.deepEqual(
    (
      await db
        .select({ id: s.pageThread.id })
        .from(s.pageThread)
        .where(
          and(
            eq(s.pageThread.pageId, pageId),
            eq(s.pageThread.status, "open"),
            eq(s.pageThread.blocking, true),
          ),
        )
    )
      .map((t) => t.id)
      .sort(),
    [blocking, plain].sort(),
  );
  const reopened = await projection<SpaceEntityOf<"pageThread">>(
    `pageThread:${blocking}`,
  );
  assert.equal(reopened?.resolvedById, null);
  // Every message replicates with its page.
  const replicated = await db
    .select({ key: s.spaceEntity.key, pageId: s.spaceEntity.pageId })
    .from(s.spaceEntity)
    .where(eq(s.spaceEntity.type, "pageThreadMessage"));
  assert.equal(replicated.filter((r) => r.pageId === pageId).length, 3);
  // The activity keeps what the threads' current state no longer shows.
  const activity = await db
    .select({
      action: s.pageActivity.action,
      actorId: s.pageActivity.actorId,
    })
    .from(s.pageActivity)
    .where(eq(s.pageActivity.pageId, pageId))
    .orderBy(s.pageActivity.createdAt);
  assert.deepEqual(
    activity.map((a) => `${a.action}:${a.actorId}`),
    [
      `thread_opened:${f.carol}`,
      `thread_opened:${f.alice}`,
      `thread_resolved:${f.alice}`,
      `thread_reopened:${f.carol}`,
      `thread_blocking_changed:${f.carol}`,
    ],
  );
  const listed = (await invoke(
    { db, principal: { userId: f.dave, surface: "mcp" }, effects: noEffects },
    "listPageThreads",
    { organizationId: f.organizationId, pageId },
  )) as { threads: { id: string; messages: unknown[] }[] };
  assert.deepEqual(
    listed.threads.map((t) => [t.id, t.messages.length]),
    [
      [blocking, 2],
      [plain, 1],
    ],
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("mentions reach only people who can read the space, and disappear for anyone who loses access", async () => {
  const f = await fixture();
  const restricted = await f.space({ accessMode: "restricted" });
  for (const [userId, level] of [
    [f.alice, "edit"],
    [f.carol, "comment"],
  ] as const)
    await f.run(f.owner, {
      type: "setSpaceGrant",
      spaceId: restricted,
      userId,
      level,
    });
  const { pageId } = await f.page(f.alice, restricted);
  const mention = (userId: string, name: string) =>
    mentionToken({ id: userId, name });
  const threadId = await f.thread(f.alice, pageId, {
    body: `${mention(f.carol, "Carol")} and ${mention(f.dave, "Dave")}, what happens on timeout?`,
  });
  // Dave cannot read the space: nothing is written for him.
  assert.deepEqual(await notificationsOf(f.dave, f.organizationId), []);
  const [carolNotice] = await notificationsOf(f.carol, f.organizationId);
  assert.equal(carolNotice?.kind, "page_mentioned");
  assert.equal(carolNotice?.spaceId, restricted);
  assert.equal(carolNotice?.detail.pageTitle, "Retries");
  // A reply notifies earlier participants; a mention wins over the reply.
  await f.run(f.carol, {
    type: "replyToPageThread",
    threadId,
    messageId: crypto.randomUUID(),
    body: `It retries once, ${mention(f.alice, "Alice")}.`,
  });
  assert.deepEqual(
    (await notificationsOf(f.alice, f.organizationId)).map((n) => n.kind),
    ["page_mentioned"],
  );
  // Blocking threads reach the page's writers.
  await f.thread(f.carol, pageId, { blocking: true, body: "Undefined." });
  assert.deepEqual(
    (await notificationsOf(f.alice, f.organizationId))
      .map((n) => n.kind)
      .sort(),
    ["page_blocking_thread", "page_mentioned"],
  );

  const inbox = createNotificationService(db);
  const visible = async (userId: string) =>
    (await inbox.list(userId, { organizationId: f.organizationId })).items.map(
      (n) => n.kind,
    );
  assert.deepEqual(await visible(f.carol), ["page_mentioned"]);
  assert.equal((await inbox.unread(f.carol))[f.organizationId], 1);
  // Carol loses access before her email goes out: her inbox no longer
  // shows the page, its title or the excerpt, and the email is skipped.
  await f.run(f.owner, {
    type: "setSpaceGrant",
    spaceId: restricted,
    userId: f.carol,
    level: null,
  });
  assert.deepEqual(await visible(f.carol), []);
  assert.equal((await inbox.unread(f.carol))[f.organizationId], undefined);
  const sent: string[] = [];
  await dispatchNotificationEmails(db, {
    limit: 500,
    send: async (email) => {
      sent.push(email.to);
    },
    baseUrl: "https://app.example.test",
  });
  assert.ok(!sent.includes(`${f.carol}@example.test`));
  assert.ok(sent.includes(`${f.alice}@example.test`));
  const [email] = await db
    .select({ status: s.notificationEmail.status })
    .from(s.notificationEmail)
    .where(eq(s.notificationEmail.notificationId, carolNotice.id));
  assert.equal(email?.status, "skipped");
  // Regaining access shows it again: access is checked at read time.
  await f.run(f.owner, {
    type: "setSpaceGrant",
    spaceId: restricted,
    userId: f.carol,
    level: "view",
  });
  assert.deepEqual(await visible(f.carol), ["page_mentioned"]);
});

void test("review requests for pages notify readers only, through the shared entry point", async () => {
  const f = await fixture();
  const { pageId } = await f.page(f.alice, f.spaceId);
  const outsider = await user("Outsider");
  await db.transaction((tx) =>
    notifyPageReviewRequested(tx, {
      organizationId: f.organizationId,
      pageId,
      actorId: f.alice,
      reviewerIds: [f.alice, f.dave, outsider],
      pullRequestId: crypto.randomUUID(),
      pullRequestTitle: "Clarify retries",
    }),
  );
  // The actor and non-members are skipped; dave reads the space.
  assert.deepEqual(
    (await notificationsOf(f.dave, f.organizationId)).map((n) => n.kind),
    ["page_review_requested"],
  );
  assert.deepEqual(await notificationsOf(f.alice, f.organizationId), []);
});

void test("page files follow the space's access: commenters attach, readers download, outsiders cannot tell", async () => {
  const f = await fixture();
  const g = await fixture();
  const objects = new Map<string, { size: number; contentType: string }>();
  const storage: ObjectStorage = {
    presignUpload: async (key, contentType, size) => {
      // The test plays the browser's PUT.
      objects.set(key, { size, contentType });
      return `https://bucket.test/${key}?put`;
    },
    presignDownload: async (key) => `https://bucket.test/${key}?get`,
    stat: async (key) => {
      const object = objects.get(key);
      if (!object) throw new Error("missing");
      return object;
    },
    copy: async (from, to) => {
      objects.set(to, objects.get(from)!);
    },
    delete: async (key) => {
      objects.delete(key);
    },
  };
  const as = (userId: string): CapabilityContext => ({
    db,
    principal: { userId, surface: "web" },
    effects: noEffects,
    storage: () => storage,
  });
  const refused = (promise: Promise<unknown>, category: string) =>
    assert.rejects(promise, (error) => {
      assert.ok(error instanceof CapabilityError, String(error));
      assert.equal(error.category, category, error.message);
      return true;
    });
  const restricted = await f.space({ accessMode: "restricted" });
  await f.run(f.owner, {
    type: "setSpaceGrant",
    spaceId: restricted,
    userId: f.carol,
    level: "comment",
  });
  const { pageId } = await f.page(f.owner, restricted);
  const upload = {
    organizationId: f.organizationId,
    pageId,
    filename: "diagram.png",
    mimeType: "image/png",
    size: 3,
  };
  const started = (await invoke(
    as(f.carol),
    "startAttachmentUpload",
    upload,
  )) as {
    id: string;
  };
  const finished = (await invoke(as(f.carol), "finishAttachmentUpload", {
    organizationId: f.organizationId,
    id: started.id,
  })) as { url: string };
  // Pages reference files with the same scheme as specifications.
  assert.equal(finished.url, `/api/files/${started.id}`);
  const [row] = await db
    .select()
    .from(s.fileObject)
    .where(eq(s.fileObject.id, started.id));
  assert.deepEqual(
    [row?.pageId, row?.workItemId, row?.projectId],
    [pageId, null, null],
  );
  // Readers list and download.
  await f.run(f.owner, {
    type: "setSpaceGrant",
    spaceId: restricted,
    userId: f.dave,
    level: "view",
  });
  const listed = (await invoke(as(f.dave), "listAttachments", {
    organizationId: f.organizationId,
    pageId,
  })) as { id: string }[];
  assert.deepEqual(
    listed.map((x) => x.id),
    [started.id],
  );
  await invoke(as(f.dave), "getAttachmentDownloadUrl", { fileId: started.id });
  // View access cannot attach; outsiders cannot list or download.
  await refused(
    invoke(as(f.dave), "startAttachmentUpload", upload),
    "forbidden",
  );
  await refused(
    invoke(as(f.alice), "getAttachmentDownloadUrl", { fileId: started.id }),
    "not_found",
  );
  await refused(
    invoke(as(f.alice), "listAttachments", {
      organizationId: f.organizationId,
      pageId,
    }),
    "not_found",
  );
  await refused(
    invoke(as(f.alice), "startAttachmentUpload", upload),
    "not_found",
  );
  // Another organization's member, and another organization's page id.
  await refused(
    invoke(as(g.owner), "getAttachmentDownloadUrl", { fileId: started.id }),
    "forbidden",
  );
  await refused(
    invoke(as(g.owner), "startAttachmentUpload", {
      ...upload,
      organizationId: g.organizationId,
    }),
    "not_found",
  );
  // A file names exactly one owner.
  await refused(
    invoke(as(f.carol), "startAttachmentUpload", {
      ...upload,
      workItemId: crypto.randomUUID(),
    }),
    "validation",
  );
  // Losing access ends downloading at once.
  await f.run(f.owner, {
    type: "setSpaceGrant",
    spaceId: restricted,
    userId: f.dave,
    level: null,
  });
  await refused(
    invoke(as(f.dave), "getAttachmentDownloadUrl", { fileId: started.id }),
    "not_found",
  );
  // The uploader removes it; history keeps the row.
  assert.deepEqual(
    await invoke(as(f.carol), "removeAttachment", {
      organizationId: f.organizationId,
      id: started.id,
    }),
    { removed: true },
  );
  await refused(
    invoke(as(f.owner), "getAttachmentDownloadUrl", { fileId: started.id }),
    "not_found",
  );
});
