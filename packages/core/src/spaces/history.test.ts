import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as Y from "yjs";
import * as s from "@lictory/core/db/schema";
import {
  PROTOCOL,
  type Command,
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
import { canWriteDraft } from "@lictory/core/spaces/draft-access";
import { DraftWriter, loadDraft } from "@lictory/core/spaces/drafts";
import {
  documentHash,
  draftStateToDocument,
  type PageNode,
} from "@lictory/core/spaces/document";

// Page history (commits, publishing, branches, pull requests, reviews,
// merges and conflict resolution) against a real, disposable PostgreSQL
// database, with real Yjs updates stored through the draft writer
// (docs/internals/spaces.md#history-commits-branches-and-pull-requests).

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_page_history_test_${crypto.randomUUID().replaceAll("-", "")}`;
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
  const sessionId = crypto.randomUUID();
  await db.insert(s.session).values({
    id: sessionId,
    token: crypto.randomUUID(),
    userId: id,
    expiresAt: new Date(Date.now() + 3_600_000),
    updatedAt: new Date(),
  });
  sessions.set(id, sessionId);
  return id;
}
const sessions = new Map<string, string>();

type Summary = Record<string, string>;

// An organization with a project whose space everyone reads:
// - owner: organization owner and project administrator (edits);
// - alice, bob: project members (edit);
// - carol: organization member with a comment grant (reviews);
// - dave: organization member (views).
async function fixture() {
  const organizationId = crypto.randomUUID();
  const [owner, alice, bob, carol, dave] = await Promise.all(
    ["Owner", "Alice", "Bob", "Carol", "Dave"].map(user),
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
    [bob!, "member"],
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
  for (const member of [alice!, bob!])
    await run(owner!, {
      type: "setProjectMember",
      projectId,
      userId: member,
      role: "member",
    });
  const space = async (publishing: "direct" | "reviewed" = "direct") => {
    const spaceId = crypto.randomUUID();
    await run(owner!, {
      type: "createSpace",
      spaceId,
      name: "Handbook",
      slug: `space-${spaceId.slice(0, 8)}`,
      home: { projectId },
      publishing,
    });
    await run(owner!, {
      type: "setSpaceGrant",
      spaceId,
      userId: carol!,
      level: "comment",
    });
    return spaceId;
  };
  const page = async (spaceId: string, title = "Retries") =>
    (await run(alice!, {
      type: "createPage",
      spaceId,
      pageId: crypto.randomUUID(),
      title,
    })) as {
      pageId: string;
      mainBranchId: string;
      commitId: string;
      draftId?: string;
    };
  return {
    organizationId,
    owner: owner!,
    alice: alice!,
    bob: bob!,
    carol: carol!,
    dave: dave!,
    run,
    space,
    page,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

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

async function draftOf(branchId: string) {
  const [draft] = await db
    .select()
    .from(s.spaceDraft)
    .where(eq(s.spaceDraft.branchId, branchId));
  assert.ok(draft, "the line has a draft");
  return draft;
}

const refOf = (draft: typeof s.spaceDraft.$inferSelect) => ({
  organizationId: draft.organizationId,
  draftId: draft.id,
  epoch: draft.epoch,
});

// Edits a line's live draft as `userId` would in the editor: a Yjs change
// on the stored state, stored by the production draft writer.
async function edit(
  userId: string,
  branchId: string,
  change: (fragment: Y.XmlFragment, doc: Y.Doc) => void,
) {
  const draft = await draftOf(branchId);
  const ref = refOf(draft);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await loadDraft(db, ref)).state);
  const before = Y.encodeStateVector(doc);
  doc.transact(() => change(doc.getXmlFragment("default"), doc));
  const update = Y.encodeStateAsUpdate(doc, before);
  const writer = new DraftWriter(db, ref, canWriteDraft);
  const sequence = await writer.submit(
    { userId, sessionId: sessions.get(userId)! },
    update,
  );
  await writer.idle();
  doc.destroy();
  return sequence;
}

function paragraph(id: string, text: string) {
  const element = new Y.XmlElement("paragraph");
  element.setAttribute("id", id);
  const content = new Y.XmlText();
  content.insert(0, text);
  element.insert(0, [content]);
  return element;
}
const appendParagraph = (id: string, text: string) => (f: Y.XmlFragment) =>
  f.push([paragraph(id, text)]);
// Replaces block `index` with a paragraph of the same id and new text.
const rewrite = (index: number, text: string) => (f: Y.XmlFragment) => {
  const old = f.get(index) as Y.XmlElement;
  const id = old.getAttribute("id")!;
  f.delete(index, 1);
  f.insert(index, [paragraph(id, text)]);
};

const texts = (content: PageNode) =>
  (content.content ?? []).map((n) =>
    (n.content ?? []).map((t) => t.text ?? "").join(""),
  );

async function headOf(branchId: string) {
  const [branch] = await db
    .select()
    .from(s.pageBranch)
    .where(eq(s.pageBranch.id, branchId));
  const [commit] = await db
    .select()
    .from(s.pageCommit)
    .where(eq(s.pageCommit.id, branch!.headCommitId));
  return { branch: branch!, commit: commit! };
}

async function commit(
  f: Fixture,
  userId: string,
  pageId: string,
  branchId: string,
  title = "Retries",
  sequence?: number,
) {
  const draft = await draftOf(branchId);
  return f.run(userId, {
    type: "commitDraft",
    pageId,
    branchId,
    draftId: draft.id,
    epoch: draft.epoch,
    expectedSequence: sequence ?? draft.sequence,
    title,
  });
}

const projection = async <T>(key: string) =>
  (
    await db
      .select({ data: s.spaceEntity.data })
      .from(s.spaceEntity)
      .where(eq(s.spaceEntity.key, key))
  )[0]?.data as T | undefined;

async function branch(
  f: Fixture,
  userId: string,
  pageId: string,
  name: string,
) {
  const branchId = crypto.randomUUID();
  await f.run(userId, { type: "createPageBranch", pageId, branchId, name });
  return branchId;
}

void test("commit seals exactly the expected sequence; later edits stay uncommitted; publishing moves main", async () => {
  const f = await fixture();
  const spaceId = await f.space();
  const { pageId, mainBranchId, commitId } = await f.page(spaceId);

  // A new draft starts with the committed content (seeded from main).
  const initial = await draftOf(mainBranchId);
  const seeded = draftStateToDocument(
    (await loadDraft(db, refOf(initial))).state,
  );
  assert.equal(
    documentHash("Retries", seeded),
    (await headOf(mainBranchId)).commit.hash,
  );

  const first = await edit(
    f.alice,
    mainBranchId,
    appendParagraph("p-alice", "Retry once."),
  );
  const second = await edit(
    f.bob,
    mainBranchId,
    appendParagraph("p-bob", "Then give up."),
  );
  const summary = await projection<SpaceEntityOf<"page">>(`page:${pageId}`);
  assert.equal(
    summary?.mainDraft?.uncommittedChanges,
    true,
    "dirty after the first edit",
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);

  // Unsaved edits cannot be sealed.
  await rejects(
    commit(f, f.owner, pageId, mainBranchId, "Retries", second + 1),
    "conflict",
    /not saved/,
  );
  // Publish exactly the first cut: Bob's later edit stays uncommitted.
  const published = await commit(
    f,
    f.owner,
    pageId,
    mainBranchId,
    "Retry policy",
    first,
  );
  assert.equal(published?.published, "true");
  const { commit: head } = await headOf(mainBranchId);
  assert.equal(head.id, published?.commitId);
  assert.deepEqual(head.parentIds, [commitId]);
  assert.deepEqual(texts(head.content as PageNode).slice(1), ["Retry once."]);
  assert.equal(head.title, "Retry policy");
  assert.match(head.markdown, /Retry once\./);
  assert.equal(head.hash, documentHash("Retry policy", head.content));
  assert.deepEqual(head.contributorIds, [f.alice, f.owner].sort());
  assert.equal(head.draftSequence, first);
  const draft = await draftOf(mainBranchId);
  assert.equal(draft.committedSequence, first);
  assert.equal(draft.sequence, second);
  const page = await projection<SpaceEntityOf<"page">>(`page:${pageId}`);
  assert.equal(page?.publishedCommitId, head.id);
  assert.equal(page?.title, "Retry policy");
  assert.equal(
    page?.approvedCommitId,
    null,
    "Direct spaces never say Approved",
  );
  assert.equal(page?.mainDraft?.uncommittedChanges, true);
  assert.equal(page?.mainDraft?.documentName, `${draft.id}.${draft.epoch}`);

  // The rest, then nothing left to commit.
  await commit(f, f.alice, pageId, mainBranchId, "Retry policy");
  const after = await headOf(mainBranchId);
  assert.deepEqual(after.commit.contributorIds, [f.alice, f.bob].sort());
  await rejects(
    commit(f, f.alice, pageId, mainBranchId, "Retry policy"),
    "validation",
    /Nothing to commit/,
  );
  // Edits that cancel out record the cut without a commit.
  await edit(f.bob, mainBranchId, appendParagraph("p-tmp", "typo"));
  await edit(f.bob, mainBranchId, (fragment) =>
    fragment.delete(fragment.length - 1, 1),
  );
  const cancelled = await commit(
    f,
    f.bob,
    pageId,
    mainBranchId,
    "Retry policy",
  );
  assert.equal(cancelled?.nothingToCommit, "true");
  assert.equal((await headOf(mainBranchId)).commit.id, after.commit.id);
  assert.equal(
    (await projection<SpaceEntityOf<"page">>(`page:${pageId}`))?.mainDraft
      ?.uncommittedChanges,
    false,
  );

  // Viewers and commenters cannot publish; a stale epoch is refused.
  await rejects(commit(f, f.carol, pageId, mainBranchId), "forbidden");
  await rejects(
    f.run(f.alice, {
      type: "commitDraft",
      pageId,
      branchId: mainBranchId,
      draftId: draft.id,
      epoch: draft.epoch + 1,
      expectedSequence: draft.sequence,
      title: "Retries",
    }),
    "conflict",
    /replaced/,
  );
  // History is immutable: the first commit is unchanged.
  const [original] = await db
    .select()
    .from(s.pageCommit)
    .where(eq(s.pageCommit.id, commitId));
  assert.deepEqual(texts(original!.content as PageNode), [""]);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("draft anchors are frozen into commit anchors when the draft is committed", async () => {
  const f = await fixture();
  const spaceId = await f.space();
  const { pageId, mainBranchId } = await f.page(spaceId);
  await edit(
    f.alice,
    mainBranchId,
    appendParagraph("p-keep", "Retry once on timeout."),
  );
  await edit(f.alice, mainBranchId, appendParagraph("p-gone", "Remove me."));
  const draft = await draftOf(mainBranchId);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await loadDraft(db, refOf(draft))).state);
  const fragment = doc.getXmlFragment("default");
  const position = (block: number, index: number) => {
    const text = (fragment.get(block) as Y.XmlElement).get(0) as Y.XmlText;
    return Buffer.from(
      Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(text, index),
      ),
    ).toString("base64");
  };
  const anchored = async (
    block: number,
    from: number,
    to: number,
    quote: string,
  ) => {
    const threadId = crypto.randomUUID();
    await f.run(f.carol, {
      type: "createPageThread",
      pageId,
      threadId,
      messageId: crypto.randomUUID(),
      anchor: {
        v: 1,
        kind: "draft",
        draftId: draft.id,
        epoch: draft.epoch,
        start: position(block, from),
        end: position(block, to),
        quote,
      },
      body: "Which timeout?",
    });
    return threadId;
  };
  const kept = await anchored(1, 14, 21, "timeout");
  const gone = await anchored(2, 0, 6, "Remove");
  doc.destroy();
  // Text is inserted before the anchor and the second paragraph deleted.
  await edit(f.bob, mainBranchId, (fr) => {
    ((fr.get(1) as Y.XmlElement).get(0) as Y.XmlText).insert(0, "Always ");
    fr.delete(2, 1);
  });
  const { commitId } = (await commit(f, f.alice, pageId, mainBranchId))!;
  const [keptRow] = await db
    .select()
    .from(s.pageThread)
    .where(eq(s.pageThread.id, kept));
  assert.deepEqual(keptRow!.anchor, {
    v: 1,
    kind: "commit",
    commitId,
    blockId: "p-keep",
    from: 21,
    to: 28,
    quote: "timeout",
  });
  assert.equal(keptRow!.commitId, commitId);
  const [goneRow] = await db
    .select()
    .from(s.pageThread)
    .where(eq(s.pageThread.id, gone));
  assert.deepEqual(goneRow!.anchor, {
    v: 1,
    kind: "detached",
    commitId,
    quote: "Remove",
  });
  const thread = await projection<SpaceEntityOf<"pageThread">>(
    `pageThread:${gone}`,
  );
  assert.equal(thread?.anchor.kind, "detached");
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("Reviewed spaces protect main; restore creates a new commit and starts a new draft epoch", async () => {
  const f = await fixture();
  const reviewed = await f.space("reviewed");
  const protectedPage = await f.page(reviewed);
  assert.equal(protectedPage.draftId, undefined);
  await rejects(
    f.run(f.alice, {
      type: "commitDraft",
      pageId: protectedPage.pageId,
      branchId: protectedPage.mainBranchId,
      draftId: crypto.randomUUID(),
      epoch: 1,
      expectedSequence: 0,
      title: "Changed",
    }),
    "forbidden",
    /protected/,
  );
  await rejects(
    f.run(f.alice, {
      type: "restorePageCommit",
      pageId: protectedPage.pageId,
      branchId: protectedPage.mainBranchId,
      commitId: protectedPage.commitId,
      expectedHead: protectedPage.commitId,
    }),
    "forbidden",
    /protected/,
  );

  const direct = await f.space();
  const { pageId, mainBranchId, commitId: first } = await f.page(direct);
  await edit(f.alice, mainBranchId, appendParagraph("p1", "Version two."));
  const { commitId: second } = (await commit(
    f,
    f.alice,
    pageId,
    mainBranchId,
  ))!;
  await edit(f.alice, mainBranchId, appendParagraph("p2", "Unsaved thought."));
  await rejects(
    f.run(f.alice, {
      type: "restorePageCommit",
      pageId,
      branchId: mainBranchId,
      commitId: first,
      expectedHead: second,
    }),
    "conflict",
    /unpublished changes.*discardDraftChanges/,
  );
  await rejects(
    f.run(f.alice, {
      type: "restorePageCommit",
      pageId,
      branchId: mainBranchId,
      commitId: first,
      expectedHead: first,
      discardDraftChanges: true,
    }),
    "conflict",
    /changed since/,
  );
  const before = await draftOf(mainBranchId);
  const restored = (await f.run(f.alice, {
    type: "restorePageCommit",
    pageId,
    branchId: mainBranchId,
    commitId: first,
    expectedHead: second,
    discardDraftChanges: true,
  }))!;
  const { commit: head } = await headOf(mainBranchId);
  assert.equal(head.id, restored.commitId);
  assert.deepEqual(head.parentIds, [second]);
  const [firstRow] = await db
    .select()
    .from(s.pageCommit)
    .where(eq(s.pageCommit.id, first));
  assert.deepEqual(head.content, firstRow!.content);
  const after = await draftOf(mainBranchId);
  assert.equal(after.epoch, before.epoch + 1);
  assert.equal(
    after.committedSequence,
    after.sequence,
    "the new epoch starts clean",
  );
  assert.deepEqual(
    draftStateToDocument((await loadDraft(db, refOf(after))).state),
    head.content,
  );
  // The old epoch no longer accepts edits.
  await assert.rejects(loadDraft(db, refOf(before)));
  await rejects(
    f.run(f.alice, {
      type: "restorePageCommit",
      pageId,
      branchId: mainBranchId,
      commitId: first,
      expectedHead: head.id,
    }),
    "validation",
    /Nothing to restore/,
  );

  // Requiring reviews closes main's draft; going back opens a new epoch
  // seeded from main's head.
  await f.run(f.owner, {
    type: "updateSpace",
    spaceId: direct,
    publishing: "reviewed",
  });
  await f.run(f.owner, {
    type: "updateSpace",
    spaceId: direct,
    publishing: "direct",
  });
  const reopened = await draftOf(mainBranchId);
  assert.equal(reopened.epoch, after.epoch + 1);
  assert.deepEqual(
    draftStateToDocument((await loadDraft(db, refOf(reopened))).state),
    head.content,
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("branches start from their base; only the author and collaborators write them; deleting keeps history", async () => {
  const f = await fixture();
  const spaceId = await f.space();
  const { pageId, mainBranchId } = await f.page(spaceId);
  await edit(f.alice, mainBranchId, appendParagraph("p1", "Published text."));
  const { commitId: base } = (await commit(f, f.alice, pageId, mainBranchId))!;

  await rejects(
    f.run(f.alice, {
      type: "createPageBranch",
      pageId,
      branchId: crypto.randomUUID(),
      name: "main",
    }),
    "validation",
    /already in use/,
  );
  await rejects(
    f.run(f.alice, {
      type: "createPageBranch",
      pageId,
      branchId: crypto.randomUUID(),
      name: "bad..name",
    }),
    "validation",
    /Branch name/,
  );
  await rejects(
    f.run(f.carol, {
      type: "createPageBranch",
      pageId,
      branchId: crypto.randomUUID(),
      name: "carol",
    }),
    "forbidden",
  );
  const branchId = await branch(f, f.alice, pageId, "timeouts");
  const draft = await draftOf(branchId);
  const { commit: head } = await headOf(branchId);
  assert.equal(head.id, base);
  assert.deepEqual(
    draftStateToDocument((await loadDraft(db, refOf(draft))).state),
    head.content,
  );
  const row = await projection<SpaceEntityOf<"pageBranch">>(
    `pageBranch:${branchId}`,
  );
  assert.equal(row?.draft?.documentName, `${draft.id}.1`);
  assert.equal(row?.draft?.uncommittedChanges, false);

  // Bob edits the space but is not a collaborator on Alice's branch.
  await assert.rejects(edit(f.bob, branchId, appendParagraph("b", "Bob")));
  await rejects(commit(f, f.bob, pageId, branchId), "forbidden", /author/);
  await rejects(
    f.run(f.bob, {
      type: "setPageBranchCollaborator",
      branchId,
      userId: f.bob,
      collaborator: true,
    }),
    "forbidden",
  );
  await rejects(
    f.run(f.alice, {
      type: "setPageBranchCollaborator",
      branchId,
      userId: f.carol,
      collaborator: true,
    }),
    "forbidden",
    /cannot edit/,
  );
  await f.run(f.alice, {
    type: "setPageBranchCollaborator",
    branchId,
    userId: f.bob,
    collaborator: true,
  });
  await edit(f.bob, branchId, appendParagraph("b", "Bob's idea."));
  assert.equal(
    (await projection<SpaceEntityOf<"pageBranch">>(`pageBranch:${branchId}`))
      ?.draft?.uncommittedChanges,
    true,
  );
  await commit(f, f.bob, pageId, branchId);
  assert.equal(
    (await headOf(mainBranchId)).commit.id,
    base,
    "main did not move",
  );

  // Deleting fences the draft and keeps the commits.
  await rejects(
    f.run(f.carol, { type: "deletePageBranch", branchId }),
    "forbidden",
  );
  await f.run(f.bob, { type: "deletePageBranch", branchId });
  const deleted = await draftOf(branchId);
  assert.ok(deleted.fencedAt);
  assert.equal(await projection(`pageBranch:${branchId}`), undefined);
  const commits = await db
    .select()
    .from(s.pageCommit)
    .where(eq(s.pageCommit.pageId, pageId));
  assert.equal(commits.length, 3);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("syncing main into a branch merges cleanly or returns conflicts to resolve explicitly", async () => {
  const f = await fixture();
  const spaceId = await f.space();
  const { pageId, mainBranchId } = await f.page(spaceId);
  await edit(f.alice, mainBranchId, (fr) => {
    fr.push([paragraph("a", "Alpha"), paragraph("b", "Beta")]);
  });
  await commit(f, f.alice, pageId, mainBranchId);
  const branchId = await branch(f, f.bob, pageId, "rewrite");
  // Independent edits: main changes a, the branch changes b.
  await edit(f.alice, mainBranchId, rewrite(1, "Alpha (main)"));
  await commit(f, f.alice, pageId, mainBranchId);
  await edit(f.bob, branchId, rewrite(2, "Beta (branch)"));
  const sync = async (
    extra: Partial<Extract<Command, { type: "syncPageBranch" }>> = {},
  ) =>
    f.run(f.bob, {
      type: "syncPageBranch",
      branchId,
      expectedHead: (await headOf(branchId)).branch.headCommitId,
      expectedTargetHead: (await headOf(mainBranchId)).branch.headCommitId,
      ...extra,
    });
  await rejects(sync(), "conflict", /uncommitted changes/);
  await commit(f, f.bob, pageId, branchId);
  const before = await draftOf(branchId);
  const clean = (await sync())!;
  const merged = await headOf(branchId);
  assert.equal(merged.commit.id, clean.commitId);
  assert.equal(merged.commit.parentIds.length, 2);
  assert.deepEqual(texts(merged.commit.content as PageNode), [
    "",
    "Alpha (main)",
    "Beta (branch)",
  ]);
  const reseeded = await draftOf(branchId);
  assert.equal(reseeded.epoch, before.epoch + 1);
  assert.deepEqual(
    draftStateToDocument((await loadDraft(db, refOf(reseeded))).state),
    merged.commit.content,
  );
  assert.equal((await sync())?.alreadyUpToDate, "true");

  // Both change a, and the titles differ: conflicts, nothing written.
  await edit(f.alice, mainBranchId, rewrite(1, "Alpha from main"));
  await commit(f, f.alice, pageId, mainBranchId, "Main title");
  await edit(f.bob, branchId, rewrite(1, "Alpha from branch"));
  await commit(f, f.bob, pageId, branchId, "Branch title");
  const head = (await headOf(branchId)).commit.id;
  await assert.rejects(sync(), (error) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.kind, "page_merge_conflicts");
    assert.match(error.message, /2 conflicts/);
    return true;
  });
  assert.equal((await headOf(branchId)).commit.id, head);
  const preview = (await invoke(
    { db, principal: { userId: f.bob, surface: "web" }, effects: noEffects },
    "previewPageMerge",
    { organizationId: f.organizationId, branchId },
  )) as {
    conflicts: { id: string; kind: string; theirs: unknown }[];
    resultHash: string | null;
  };
  assert.equal(preview.resultHash, null);
  const ids = preview.conflicts.map((c) => c.id);
  assert.deepEqual(
    preview.conflicts.map((c) => c.kind),
    ["title", "content"],
  );
  await rejects(
    sync({ resolutions: { [ids[1]!]: "theirs" } }),
    "validation",
    /title/,
  );
  await rejects(
    sync({ resolutions: { "page-conflict:9": "ours" } }),
    "conflict",
    /no longer exist/,
  );
  const resolved = (await sync({
    resolutions: { [ids[0]!]: { title: "Agreed title" }, [ids[1]!]: "theirs" },
  }))!;
  const result = await headOf(branchId);
  assert.equal(result.commit.id, resolved.commitId);
  assert.equal(result.commit.title, "Agreed title");
  assert.deepEqual(texts(result.commit.content as PageNode), [
    "",
    "Alpha from main",
    "Beta (branch)",
  ]);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("pull requests: reviews bind to the result, go stale on change, and gate the merge", async () => {
  const f = await fixture();
  const spaceId = await f.space("reviewed");
  const { pageId, mainBranchId, commitId: mainHead } = await f.page(spaceId);
  const branchId = await branch(f, f.alice, pageId, "policy");
  await edit(f.alice, branchId, appendParagraph("p1", "Retry once."));
  await commit(f, f.alice, pageId, branchId, "Retry policy");
  const pullRequestId = crypto.randomUUID();
  await f.run(f.alice, {
    type: "createPagePullRequest",
    pageId,
    pullRequestId,
    sourceBranchId: branchId,
    title: "Define retries",
    draft: true,
  });
  const heads = async () => ({
    inspectedSourceHead: (await headOf(branchId)).branch.headCommitId,
    inspectedTargetHead: (await headOf(mainBranchId)).branch.headCommitId,
  });
  const decide = async (
    userId: string,
    decision: "approve" | "request_changes" | "revoke",
  ) =>
    f.run(userId, {
      type: "decidePagePullRequest",
      pullRequestId,
      decision,
      ...(await heads()),
    });
  const merge = async (userId = f.owner) =>
    f.run(userId, {
      type: "mergePagePullRequest",
      pullRequestId,
      ...(await heads()),
    });

  await rejects(decide(f.carol, "approve"), "conflict", /draft/);
  await f.run(f.alice, {
    type: "updatePagePullRequest",
    pullRequestId,
    draft: false,
  });
  await rejects(merge(), "conflict", /request at least one required review/);
  await rejects(
    f.run(f.alice, {
      type: "requestPageReview",
      pullRequestId,
      userId: f.alice,
      required: true,
    }),
    "validation",
    /contributed/,
  );
  await rejects(
    f.run(f.alice, {
      type: "requestPageReview",
      pullRequestId,
      userId: f.dave,
      required: true,
    }),
    "forbidden",
  );
  await f.run(f.alice, {
    type: "requestPageReview",
    pullRequestId,
    userId: f.carol,
    required: true,
  });
  const requested = await db
    .select()
    .from(s.notification)
    .where(
      and(
        eq(s.notification.userId, f.carol),
        eq(s.notification.kind, "page_review_requested"),
      ),
    );
  assert.equal(requested.length, 1);
  await rejects(merge(), "conflict", /required reviewer/);
  // Contributors cannot approve their own change; viewers cannot review.
  await rejects(decide(f.alice, "approve"), "forbidden", /contributed/);
  await rejects(decide(f.dave, "approve"), "forbidden");
  await rejects(
    f.run(f.carol, {
      type: "decidePagePullRequest",
      pullRequestId,
      decision: "approve",
      inspectedSourceHead: mainHead,
      inspectedTargetHead: mainHead,
    }),
    "conflict",
    /Inspect the updated merge result/,
  );
  await decide(f.carol, "approve");
  let pr = await projection<SpaceEntityOf<"pagePullRequest">>(
    `pagePullRequest:${pullRequestId}`,
  );
  assert.deepEqual(pr?.mergeability?.blockers, []);
  assert.equal(pr?.mergeability?.requiredApprovals, 1);

  // A new commit on the source makes the approval stale and tells Carol.
  await edit(f.alice, branchId, appendParagraph("p2", "Log each retry."));
  pr = await projection<SpaceEntityOf<"pagePullRequest">>(
    `pagePullRequest:${pullRequestId}`,
  );
  assert.deepEqual(pr?.mergeability?.blockers, ["uncommitted_source"]);
  await rejects(merge(), "conflict", /uncommitted changes/);
  await commit(f, f.alice, pageId, branchId, "Retry policy");
  const [stale] = await db
    .select()
    .from(s.pagePullRequestReview)
    .where(eq(s.pagePullRequestReview.pullRequestId, pullRequestId));
  assert.ok(stale!.staleAt);
  assert.match(stale!.staleReason!, /policy changed/);
  const invalidated = await db
    .select()
    .from(s.notification)
    .where(
      and(
        eq(s.notification.userId, f.carol),
        eq(s.notification.kind, "page_approval_invalidated"),
      ),
    );
  assert.equal(invalidated.length, 1);
  await rejects(merge(), "conflict", /required reviewer/);

  // Changes requested block the merge, even with a required approval.
  await decide(f.carol, "approve");
  await decide(f.bob, "request_changes");
  await rejects(merge(), "conflict", /requested changes/);
  await decide(f.bob, "revoke");

  // A blocking discussion on the page blocks merging into main.
  const threadId = crypto.randomUUID();
  await f.run(f.carol, {
    type: "createPageThread",
    pageId,
    threadId,
    messageId: crypto.randomUUID(),
    anchor: { v: 1, kind: "page" },
    body: "What about idempotency?",
    blocking: true,
    pullRequestId,
  });
  pr = await projection<SpaceEntityOf<"pagePullRequest">>(
    `pagePullRequest:${pullRequestId}`,
  );
  assert.deepEqual(pr?.mergeability?.blockers, ["blocking_threads"]);
  await rejects(merge(), "conflict", /blocking discussion/);
  await f.run(f.carol, { type: "resolvePageThread", threadId });

  // Commenters cannot merge into main; editors can.
  await rejects(merge(f.carol), "forbidden");
  const merged = (await merge())!;
  const { commit: head } = await headOf(mainBranchId);
  assert.equal(head.id, merged.commitId);
  assert.deepEqual(head.approverIds, [f.carol]);
  assert.equal(head.pullRequestId, pullRequestId);
  assert.equal(head.title, "Retry policy");
  assert.deepEqual(texts(head.content as PageNode), [
    "",
    "Retry once.",
    "Log each retry.",
  ]);
  const page = await projection<SpaceEntityOf<"page">>(`page:${pageId}`);
  assert.equal(page?.publishedCommitId, head.id);
  assert.equal(page?.approvedCommitId, head.id);
  // The source branch is retired automatically and recorded as such.
  const [source] = await db
    .select()
    .from(s.pageBranch)
    .where(eq(s.pageBranch.id, branchId));
  assert.ok(source!.deletedAt);
  assert.ok((await draftOf(branchId)).fencedAt);
  const activity = await db
    .select()
    .from(s.pageActivity)
    .where(
      and(
        eq(s.pageActivity.pageId, pageId),
        eq(s.pageActivity.action, "branch_deleted"),
      ),
    );
  assert.equal(activity[0]?.detail.automatic, true);
  pr = await projection<SpaceEntityOf<"pagePullRequest">>(
    `pagePullRequest:${pullRequestId}`,
  );
  assert.equal(pr?.status, "merged");
  assert.equal(pr?.mergeability, null);
  await rejects(merge(), "conflict", /already merged/);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("merging into another branch moves only that branch; direct spaces need no review but honour requests for changes", async () => {
  const f = await fixture();
  const spaceId = await f.space();
  const { pageId, mainBranchId, commitId: mainHead } = await f.page(spaceId);
  const target = await branch(f, f.alice, pageId, "draft-policy");
  const source = await branch(f, f.bob, pageId, "addition");
  await edit(f.bob, source, appendParagraph("p1", "Addition."));
  await commit(f, f.bob, pageId, source);
  const pullRequestId = crypto.randomUUID();
  await f.run(f.bob, {
    type: "createPagePullRequest",
    pageId,
    pullRequestId,
    sourceBranchId: source,
    targetBranchId: target,
    title: "Add to the draft policy",
  });
  const heads = async () => ({
    inspectedSourceHead: (await headOf(source)).branch.headCommitId,
    inspectedTargetHead: (await headOf(target)).branch.headCommitId,
  });
  await f.run(f.carol, {
    type: "decidePagePullRequest",
    pullRequestId,
    decision: "request_changes",
    ...(await heads()),
  });
  await rejects(
    f.run(f.alice, {
      type: "mergePagePullRequest",
      pullRequestId,
      ...(await heads()),
    }),
    "conflict",
    /requested changes/,
  );
  await f.run(f.carol, {
    type: "decidePagePullRequest",
    pullRequestId,
    decision: "revoke",
    ...(await heads()),
  });
  // Only the target's author (or collaborators) merges into a branch.
  await rejects(
    f.run(f.bob, {
      type: "mergePagePullRequest",
      pullRequestId,
      ...(await heads()),
    }),
    "forbidden",
  );
  const merged = (await f.run(f.alice, {
    type: "mergePagePullRequest",
    pullRequestId,
    ...(await heads()),
  }))!;
  assert.equal((await headOf(target)).commit.id, merged.commitId);
  assert.equal(
    (await headOf(mainBranchId)).commit.id,
    mainHead,
    "main did not move",
  );
  const [kept] = await db
    .select()
    .from(s.pageBranch)
    .where(eq(s.pageBranch.id, source));
  assert.equal(
    kept!.deletedAt,
    null,
    "only merges into main retire the source",
  );

  // Closing an unmerged pull request keeps it as history and resolves its
  // open discussions; reviewers may decline a request.
  const closing = crypto.randomUUID();
  await f.run(f.bob, {
    type: "createPagePullRequest",
    pageId,
    pullRequestId: closing,
    sourceBranchId: source,
    title: "Publish the addition",
  });
  await f.run(f.bob, {
    type: "requestPageReview",
    pullRequestId: closing,
    userId: f.carol,
    required: false,
  });
  await f.run(f.carol, {
    type: "cancelPageReview",
    pullRequestId: closing,
    userId: f.carol,
  });
  const threadId = crypto.randomUUID();
  await f.run(f.carol, {
    type: "createPageThread",
    pageId,
    threadId,
    messageId: crypto.randomUUID(),
    anchor: { v: 1, kind: "page" },
    body: "Not yet.",
    blocking: true,
    pullRequestId: closing,
  });
  await rejects(
    f.run(f.bob, { type: "deletePageBranch", branchId: source }),
    "conflict",
    /unmerged pull request/,
  );
  await rejects(
    f.run(f.carol, { type: "deletePagePullRequest", pullRequestId: closing }),
    "forbidden",
  );
  await f.run(f.bob, { type: "deletePagePullRequest", pullRequestId: closing });
  const [closed] = await db
    .select()
    .from(s.pagePullRequest)
    .where(eq(s.pagePullRequest.id, closing));
  assert.ok(closed!.deletedAt);
  const [resolved] = await db
    .select()
    .from(s.pageThread)
    .where(eq(s.pageThread.id, threadId));
  assert.equal(resolved!.status, "resolved");
  assert.equal(await projection(`pagePullRequest:${closing}`), undefined);
  await f.run(f.bob, { type: "deletePageBranch", branchId: source });
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("agents propose page changes as pull requests; they cannot approve or merge their own proposal", async () => {
  const f = await fixture();
  const spaceId = await f.space("reviewed");
  const { pageId, mainBranchId, commitId: mainHead } = await f.page(spaceId);
  const agent: CapabilityContext = {
    db,
    principal: { userId: f.alice, surface: "mcp" },
    effects: noEffects,
  };
  const proposed = (await invoke(agent, "proposePageChange", {
    organizationId: f.organizationId,
    pageId,
    title: "Retry policy",
    markdown: "## Retries\n\nRetry **once** after a timeout.\n\n- [ ] Log it",
    message: "Define the retry policy",
  })) as Summary;
  assert.ok(
    proposed.pullRequestId &&
      proposed.branchId &&
      proposed.commitId &&
      proposed.draftId,
  );
  const [commitRow] = await db
    .select()
    .from(s.pageCommit)
    .where(eq(s.pageCommit.id, proposed.commitId));
  assert.match(commitRow!.markdown, /## Retries/);
  assert.match(commitRow!.markdown, /- \[ \] Log it/);
  assert.equal(
    (await headOf(mainBranchId)).commit.id,
    mainHead,
    "nothing was published",
  );
  const [pr] = await db
    .select()
    .from(s.pagePullRequest)
    .where(eq(s.pagePullRequest.id, proposed.pullRequestId));
  assert.equal(pr?.status, "open");
  assert.equal(pr?.title, "Define the retry policy");
  const [activity] = await db
    .select()
    .from(s.pageActivity)
    .where(
      and(
        eq(s.pageActivity.pageId, pageId),
        eq(s.pageActivity.action, "page_change_proposed"),
      ),
    );
  assert.equal(activity?.detail.performedVia, "mcp");
  const heads = {
    inspectedSourceHead: proposed.commitId,
    inspectedTargetHead: mainHead,
  };
  const refused = (promise: Promise<unknown>, category: string) =>
    assert.rejects(promise, (error) => {
      assert.ok(error instanceof CapabilityError, String(error));
      assert.equal(error.category, category, error.message);
      return true;
    });
  await refused(
    invoke(agent, "decidePagePullRequest", {
      organizationId: f.organizationId,
      pullRequestId: proposed.pullRequestId,
      decision: "approve",
      ...heads,
    }),
    "forbidden",
  );
  await refused(
    invoke(agent, "mergePagePullRequest", {
      organizationId: f.organizationId,
      pullRequestId: proposed.pullRequestId,
      ...heads,
    }),
    "conflict",
  );
  // Invalid content is refused with the engine's reason.
  await refused(
    invoke(agent, "proposePageChange", {
      organizationId: f.organizationId,
      pageId,
      title: "Broken",
      content: {
        type: "doc",
        content: [{ type: "image", attrs: { src: "javascript:alert(1)" } }],
      },
      message: "Broken",
    }),
    "validation",
  );
  // Viewers cannot propose.
  await refused(
    invoke(
      { ...agent, principal: { userId: f.dave, surface: "mcp" } },
      "proposePageChange",
      {
        organizationId: f.organizationId,
        pageId,
        title: "Mine",
        markdown: "Text",
        message: "Mine",
      },
    ),
    "forbidden",
  );
  // History reads.
  const history = (await invoke(agent, "listPageCommits", {
    organizationId: f.organizationId,
    pageId,
  })) as { commits: { id: string }[] };
  assert.deepEqual(
    history.commits.map((c) => c.id),
    [proposed.commitId, mainHead],
  );
  const old = (await invoke(agent, "getPage", {
    organizationId: f.organizationId,
    pageId,
    commitId: proposed.commitId,
  })) as { published: boolean; title: string };
  assert.equal(old.published, false);
  assert.equal(old.title, "Retry policy");
  const diff = (await invoke(agent, "diffPageCommits", {
    organizationId: f.organizationId,
    pageId,
    fromCommitId: mainHead,
    toCommitId: proposed.commitId,
  })) as { titleChanged: boolean; changes: { kind: string }[] };
  assert.equal(diff.titleChanged, true);
  assert.ok(diff.changes.some((c) => c.kind === "added"));
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("history commands refuse other organizations' identifiers and hide restricted pages", async () => {
  const f = await fixture();
  const g = await fixture();
  const spaceId = await f.space();
  const { pageId, mainBranchId, commitId } = await f.page(spaceId);
  const other = await g.page(await g.space());
  // Someone else's page, branch or commit is simply unavailable.
  await rejects(
    g.run(g.alice, {
      type: "createPageBranch",
      pageId,
      branchId: crypto.randomUUID(),
      name: "x",
    }),
    "not_found",
  );
  await rejects(
    g.run(g.alice, { type: "deletePageBranch", branchId: mainBranchId }),
    "not_found",
  );
  await rejects(
    f.run(f.alice, {
      type: "createPageBranch",
      pageId,
      branchId: crypto.randomUUID(),
      name: "y",
      fromCommitId: other.commitId,
    }),
    "not_found",
  );
  await rejects(
    f.run(f.alice, {
      type: "restorePageCommit",
      pageId,
      branchId: other.mainBranchId,
      commitId,
      expectedHead: commitId,
    }),
    "not_found",
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
  assert.deepEqual(await projectionDrift(db, g.organizationId), []);
});
