// Live drafts of specifications against real PostgreSQL: authorization of
// the draft writer, sealing exact stored cuts into revisions and commits with
// byte-identical Markdown for untouched blocks, epochs that follow the line's
// head, protected main and branch collaborator rules, and the projection
// invariant. See docs/internals/specification-drafts.md.
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
  type EntityOf,
} from "@lictory/core/contracts/protocol";
import { seedOrganization } from "@lictory/core/domain/organization";
import {
  directory,
  executeMutation,
  snapshot,
} from "@lictory/core/domain/service";
import { projectionDrift } from "@lictory/core/domain/projection-reader.test-helper";
import {
  appendDraftUpdates,
  DraftWriter,
  loadDraft,
  type DraftRef,
} from "@lictory/core/spaces/drafts";
import {
  canEditSpecificationDraft,
  resolveSpecificationDraftDocument,
} from "@lictory/core/domain/specification-draft-access";
import {
  draftStateToMarkdown,
  markdownToDraftState,
} from "@lictory/core/editor/draft-state";
import { specificationDraftDocumentName } from "@lictory/core/spaces/collaboration-protocol";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_spec_draft_test_${crypto.randomUUID().replaceAll("-", "")}`;
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

// A specification with Markdown the editor would write differently: `*`
// bullets, a Setext heading, `1)` lists, a hard break with two spaces, an
// aligned table and a trailing newline. Untouched, every byte must survive.
const ORIGINAL = `Plain opening paragraph.

Intro paragraph with *emphasis* and a hard
break.

* star bullet
* second bullet

Setext heading
==============

1) paren list

| a | b |
|---|:-:|
| 1 | 2 |

Last paragraph.
`;

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(description = ORIGINAL) {
  const organizationId = crypto.randomUUID();
  // Owner: every default discipline. Reviewer: Engineering and QA, which
  // review but do not edit specifications. Outsider: a member without
  // disciplines.
  const [owner, reviewer, outsider] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  await db.insert(s.user).values(
    [owner, reviewer, outsider].map((id) => ({
      id,
      name: id === owner ? "Anna" : id === reviewer ? "Ben" : "Cleo",
      email: `${id}@example.test`,
    })),
  );
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [owner, reviewer, outsider].map((userId) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: userId === owner ? "owner" : "member",
      createdAt: new Date(),
    })),
  );
  const sessions = new Map<string, string>();
  for (const userId of [owner, reviewer, outsider]) {
    const sessionId = crypto.randomUUID();
    await db.insert(s.session).values({
      id: sessionId,
      token: crypto.randomUUID(),
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      updatedAt: new Date(),
    });
    sessions.set(userId, sessionId);
  }
  await seedOrganization(db, organizationId);
  const command = async (c: Command, actor = owner) =>
    executeMutation(
      db,
      { userId: actor },
      {
        protocol: PROTOCOL,
        id: crypto.randomUUID(),
        organizationId,
        command: c,
      },
    );
  const projectId = crypto.randomUUID();
  await command({
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
  });
  const dir = await directory(db, owner, organizationId);
  const roles = Object.fromEntries(
    dir.disciplines
      .filter((d) => d.projectId === projectId)
      .map((d) => [d.name, d.id]),
  ) as { Product: string; Engineering: string; QA: string };
  for (const userId of [reviewer, outsider])
    await command({
      type: "setProjectMember",
      projectId,
      userId,
      role: "member",
    });
  for (const disciplineId of [roles.Engineering, roles.QA])
    await command({
      type: "setDisciplineMember",
      projectId,
      disciplineId,
      userId: reviewer,
      member: true,
    });
  for (const disciplineId of [roles.Engineering, roles.QA])
    await command({
      type: "setDisciplineMember",
      projectId,
      disciplineId,
      userId: owner,
      member: true,
    });
  const story = dir.types.find((t) => t.name === "Story")!.id;
  const workItemId = crypto.randomUUID();
  await command({
    type: "createWorkItem",
    projectId,
    workItemId,
    typeId: story,
    parentId: null,
    title: "Safe retries",
    description,
  });
  const scope = { organizationId, projectId, workItemId };
  const entities = () =>
    db.transaction((tx) => snapshot(tx, scope), { accessMode: "read only" });
  const revisions = async () =>
    (await entities())
      .filter((e): e is EntityOf<"revision"> => e.type === "revision")
      .sort((a, b) => a.number - b.number);
  const drafts = async () =>
    (await entities()).filter(
      (e): e is EntityOf<"specDraft"> => e.type === "specDraft",
    );
  const author = (userId: string) => ({
    userId,
    sessionId: sessions.get(userId)!,
  });
  return {
    organizationId,
    projectId,
    workItemId,
    owner,
    reviewer,
    outsider,
    roles,
    command,
    entities,
    revisions,
    drafts,
    author,
  };
}

// Opens a line's draft through the domain command and returns its ref.
async function open(f: Fixture, branchId?: string, actor = f.owner) {
  const result = await f.command(
    {
      type: "openSpecificationDraft",
      workItemId: f.workItemId,
      ...(branchId ? { branchId } : {}),
    },
    actor,
  );
  const summary = result.summary as {
    draftId: string;
    epoch: number;
    documentName: string;
  };
  assert.equal(
    summary.documentName,
    specificationDraftDocumentName({
      draftId: summary.draftId,
      epoch: summary.epoch,
    }),
  );
  return {
    organizationId: f.organizationId,
    draftId: summary.draftId,
    epoch: summary.epoch,
    kind: "specification",
  } satisfies DraftRef;
}

// One editor's change, as the browser's Yjs document would send it: applied
// to the stored state and stored by the draft writer's append.
async function edit(
  f: Fixture,
  ref: DraftRef,
  userId: string,
  change: (fragment: Y.XmlFragment, doc: Y.Doc) => void,
) {
  const { state } = await loadDraft(db, ref);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const vector = Y.encodeStateVector(doc);
    doc.transact(() => change(doc.getXmlFragment("default"), doc));
    return await appendDraftUpdates(
      db,
      ref,
      [{ ...f.author(userId), update: Y.encodeStateAsUpdate(doc, vector) }],
      canEditSpecificationDraft,
    );
  } finally {
    doc.destroy();
  }
}

// Appends text to the top-level block at `index` (a paragraph or heading).
const appendTo = (index: number, text: string) => (fragment: Y.XmlFragment) => {
  const block = fragment.get(index) as Y.XmlElement;
  const inline = block.get(block.length - 1) as Y.XmlText;
  inline.insert(inline.length, text);
};

async function seal(
  f: Fixture,
  ref: DraftRef,
  expectedSequence: number,
  extra: Partial<Extract<Command, { type: "commitSpecificationDraft" }>> = {},
  actor = f.owner,
) {
  return f.command(
    {
      type: "commitSpecificationDraft",
      workItemId: f.workItemId,
      draftId: ref.draftId,
      epoch: ref.epoch,
      expectedSequence,
      ...extra,
    },
    actor,
  );
}

void test("the Markdown a draft starts from converts back byte for byte", () => {
  const state = markdownToDraftState(ORIGINAL);
  assert.equal(draftStateToMarkdown(state, ORIGINAL), ORIGINAL);
  assert.equal(draftStateToMarkdown(markdownToDraftState(""), ""), "");
});

void test("saving a main draft seals exactly the stored cut into one revision, untouched blocks byte-identical", async () => {
  const f = await fixture();
  const ref = await open(f);
  const [first] = await f.revisions();
  // Seven top-level blocks; the last paragraph is index 6.
  const { sequence } = await edit(f, ref, f.owner, appendTo(6, " Edited."));
  assert.equal(sequence, 1);
  // A later edit is stored but not part of the cut.
  await edit(f, ref, f.owner, appendTo(0, " Typed later."));
  await seal(f, ref, 1, { message: "Clarify the last paragraph" });
  const revisions = await f.revisions();
  assert.equal(revisions.length, 2);
  const second = revisions[1]!;
  assert.equal(second.title, first!.title);
  assert.equal(
    second.content,
    ORIGINAL.replace("Last paragraph.", "Last paragraph. Edited."),
  );
  assert.equal(second.changeSummary, "Clarify the last paragraph");
  // The edit after the cut stays unsaved.
  const [after] = await f.drafts();
  assert.equal(after?.committedSequence, 1);
  assert.equal(after?.uncommittedChanges, true);
  assert.equal(after?.baseRevisionId, second.id);
  assert.equal(after?.epoch, 1, "sealing never starts a new epoch");
  // Saving again seals the later edit on top of revision 2, keeping its
  // bytes too.
  await seal(f, ref, 2);
  const third = (await f.revisions())[2]!;
  assert.equal(
    third.content,
    ORIGINAL.replace("Last paragraph.", "Last paragraph. Edited.").replace(
      "Plain opening paragraph.",
      "Plain opening paragraph. Typed later.",
    ),
  );
  // Who wrote what is recorded beside who saved it.
  const revised = (await f.entities()).filter(
    (e): e is EntityOf<"activity"> =>
      e.type === "activity" && e.action === "revised",
  );
  assert.deepEqual(revised.at(-1)?.detail?.contributorIds, [f.owner]);
  // Nothing left to save.
  await assert.rejects(seal(f, ref, 2), /Nothing to save/);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("a saved revision marks approvals outdated and re-requests reviews, as today", async () => {
  const f = await fixture();
  const [first] = await f.revisions();
  const base = { workItemId: f.workItemId, baseRevisionId: first!.id };
  // Two required reviews; Engineering approves revision 1, QA has not
  // decided, so the item is not ready and main stays writable.
  for (const disciplineId of [f.roles.Engineering, f.roles.QA])
    await f.command({
      type: "requestReview",
      ...base,
      reviewId: crypto.randomUUID(),
      disciplineId,
      userId: f.reviewer,
      required: true,
    });
  const review = (await f.entities()).find(
    (e): e is EntityOf<"review"> =>
      e.type === "review" && e.responsibility === "Engineering",
  )!;
  await f.command(
    { type: "decideReview", ...base, reviewId: review.id, decision: "approve" },
    f.reviewer,
  );
  assert.ok(
    (await f.entities()).some(
      (e) => e.type === "approval" && e.status === "granted",
    ),
  );
  const ref = await open(f);
  await edit(f, ref, f.owner, appendTo(0, " Changed."));
  await seal(f, ref, 1);
  const entities = await f.entities();
  const approvals = entities.filter(
    (e): e is EntityOf<"approval"> => e.type === "approval",
  );
  assert.ok(approvals.some((a) => a.status === "stale"));
  const latest = (await f.revisions()).at(-1)!;
  const reviews = entities.filter(
    (e): e is EntityOf<"review"> => e.type === "review",
  );
  assert.ok(
    reviews.some((r) => r.revisionId === latest.id && r.status === "requested"),
    "the review is requested again on the new revision",
  );
});

void test("concurrent saves of one cut create exactly one revision", async () => {
  const f = await fixture();
  const ref = await open(f);
  await edit(f, ref, f.owner, appendTo(0, " Once."));
  const results = await Promise.allSettled([
    seal(f, ref, 1),
    seal(f, ref, 1, {}, f.owner),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const refused = results.find((r) => r.status === "rejected");
  assert.match(String(refused?.reason), /Nothing to save|already saved/);
  assert.equal((await f.revisions()).length, 2);
  // A cut that is not stored yet is refused.
  await assert.rejects(seal(f, ref, 5), /not saved yet/);
});

void test("the draft writer and the collaboration service let only the line's editors write", async () => {
  const f = await fixture();
  const ref = await open(f);
  const name = specificationDraftDocumentName(ref);
  assert.deepEqual(await resolveSpecificationDraftDocument(db, name), ref);
  assert.equal(
    await resolveSpecificationDraftDocument(db, `${ref.draftId}.1`),
    null,
  );
  const may = (userId: string) =>
    db.transaction((tx) => canEditSpecificationDraft(tx, userId, ref));
  assert.equal(await may(f.owner), true);
  // Reviewing disciplines do not edit specifications; neither does a
  // member without disciplines.
  assert.equal(await may(f.reviewer), false);
  assert.equal(await may(f.outsider), false);
  // Neither can open main's draft.
  await assert.rejects(
    f.command(
      { type: "openSpecificationDraft", workItemId: f.workItemId },
      f.reviewer,
    ),
    /edit specifications|Edit specifications|capabilit/i,
  );
  // A denied author's update is refused at write time; the others are
  // stored in the same batch.
  const { state } = await loadDraft(db, ref);
  const update = (text: string) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const vector = Y.encodeStateVector(doc);
    appendTo(0, text)(doc.getXmlFragment("default"));
    const u = Y.encodeStateAsUpdate(doc, vector);
    doc.destroy();
    return u;
  };
  const stored = await appendDraftUpdates(
    db,
    ref,
    [
      { ...f.author(f.outsider), update: update(" outsider") },
      { ...f.author(f.owner), update: update(" owner") },
    ],
    canEditSpecificationDraft,
  );
  assert.equal(stored.sequence, 1);
  assert.equal(stored.denied.size, 1);
  // Revoking the discipline ends writing at once.
  await f.command({
    type: "setDisciplineMember",
    projectId: f.projectId,
    disciplineId: f.roles.Product,
    userId: f.owner,
    member: false,
  });
  assert.equal(await may(f.owner), false);
  const writer = new DraftWriter(db, ref, canEditSpecificationDraft);
  await assert.rejects(
    writer.submit(f.author(f.owner), update(" after revocation")),
    /no longer edit this specification/,
  );
  // So is saving.
  await assert.rejects(
    seal(f, ref, 1),
    /edit specifications|Edit specifications|capabilit/i,
  );
});

void test("a head moved from outside the draft starts a new epoch; a title change only moves its base", async () => {
  const f = await fixture();
  const ref = await open(f);
  await edit(f, ref, f.owner, appendTo(0, " Stored but unsaved."));
  const [first] = await f.revisions();
  // Renaming keeps the content: same epoch, new base.
  await f.command({
    type: "updateSpecification",
    workItemId: f.workItemId,
    baseRevisionId: first!.id,
    title: "Safe payment retries",
    content: first!.content,
  });
  const renamed = (await f.revisions()).at(-1)!;
  let [draft] = await f.drafts();
  assert.equal(draft?.epoch, 1);
  assert.equal(draft?.baseRevisionId, renamed.id);
  // A revision saved another way (an agent, the API) replaces the content:
  // a new epoch seeded from it; the old epoch's edits are refused.
  await f.command({
    type: "updateSpecification",
    workItemId: f.workItemId,
    baseRevisionId: renamed.id,
    title: renamed.title,
    content: "# Behavior\n\nRetries reuse the original transaction ID.\n",
  });
  [draft] = await f.drafts();
  assert.equal(draft?.epoch, 2);
  assert.equal(draft?.uncommittedChanges, false);
  await assert.rejects(
    edit(f, ref, f.owner, appendTo(0, " Late.")),
    /no longer available/,
  );
  assert.equal(
    await resolveSpecificationDraftDocument(
      db,
      specificationDraftDocumentName(ref),
    ),
    null,
  );
  const next = { ...ref, epoch: 2 };
  const { state } = await loadDraft(db, next);
  assert.equal(
    draftStateToMarkdown(
      state,
      "# Behavior\n\nRetries reuse the original transaction ID.\n",
    ),
    "# Behavior\n\nRetries reuse the original transaction ID.\n",
  );
  // The replaced epoch stays reconstructable: its seed (with the Markdown
  // it started from) and its stored update.
  const seeds = await db
    .select()
    .from(s.specificationDraftSeed)
    .where(eq(s.specificationDraftSeed.draftId, ref.draftId));
  assert.deepEqual(seeds.map((seed) => seed.epoch).sort(), [1, 2]);
  assert.equal(seeds.find((seed) => seed.epoch === 1)?.source, ORIGINAL);
  // Saving the old epoch is refused with a reason to reopen.
  await assert.rejects(seal(f, ref, 1), /closed or replaced/);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("protected main refuses its draft; branch drafts follow branch collaborators", async () => {
  const f = await fixture();
  const ref = await open(f);
  await edit(f, ref, f.owner, appendTo(0, " Draft text."));
  const [first] = await f.revisions();
  // Main becomes protected (readiness latched).
  await db
    .update(s.workItem)
    .set({ mainProtected: true })
    .where(eq(s.workItem.id, f.workItemId));
  assert.equal(
    await db.transaction((tx) => canEditSpecificationDraft(tx, f.owner, ref)),
    false,
  );
  await assert.rejects(seal(f, ref, 1), /This specification is ready/);
  await assert.rejects(
    f.command({ type: "openSpecificationDraft", workItemId: f.workItemId }),
    /This specification is ready/,
  );
  // Changes now go through a branch: the reviewer (no edit capability)
  // creates one and edits its draft; others need an invitation.
  const branchId = crypto.randomUUID();
  await f.command(
    {
      type: "createBranch",
      workItemId: f.workItemId,
      baseRevisionId: first!.id,
      branchId,
      name: "ben/retries",
    },
    f.reviewer,
  );
  // The main draft was closed when the command saw protected main.
  assert.equal((await f.drafts()).filter((d) => !d.branchId).length, 0);
  const branchRef = await open(f, branchId, f.reviewer);
  await assert.rejects(open(f, branchId, f.owner), /invited collaborators/);
  await f.command(
    {
      type: "setBranchCollaborator",
      workItemId: f.workItemId,
      branchId,
      userId: f.owner,
      assigned: true,
    },
    f.reviewer,
  );
  // Both type into the same draft.
  await edit(f, branchRef, f.reviewer, appendTo(6, " From Ben."));
  await edit(f, branchRef, f.owner, appendTo(0, " From Anna."));
  await seal(f, branchRef, 2, { message: "Edited together" }, f.owner);
  const branch = (await f.entities()).find(
    (e): e is EntityOf<"specBranch"> =>
      e.type === "specBranch" && e.id === branchId,
  )!;
  const head = (await f.entities()).find(
    (e): e is EntityOf<"specCommit"> =>
      e.type === "specCommit" && e.id === branch.headId,
  )!;
  assert.equal(head.message, "Edited together");
  assert.equal(head.authorId, f.owner);
  assert.equal(
    head.content,
    ORIGINAL.replace("Last paragraph.", "Last paragraph. From Ben.").replace(
      "Plain opening paragraph.",
      "Plain opening paragraph. From Anna.",
    ),
  );
  // Main is untouched: a branch commit is never a revision.
  assert.equal((await f.revisions()).length, 1);
  const committed = (await f.entities()).find(
    (e): e is EntityOf<"activity"> =>
      e.type === "activity" && e.action === "branch_committed",
  );
  assert.deepEqual(
    committed?.detail?.contributorIds,
    [f.owner, f.reviewer].sort(),
  );
  // Removing a collaborator ends their writing.
  await f.command(
    {
      type: "setBranchCollaborator",
      workItemId: f.workItemId,
      branchId,
      userId: f.owner,
      assigned: false,
    },
    f.reviewer,
  );
  assert.equal(
    await db.transaction((tx) =>
      canEditSpecificationDraft(tx, f.owner, branchRef),
    ),
    false,
  );
  await assert.rejects(
    seal(f, branchRef, 2, {}, f.owner),
    /invited collaborators/,
  );
  // Deleting the branch closes its draft; its commits stay.
  await f.command(
    { type: "deleteBranch", workItemId: f.workItemId, branchId },
    f.reviewer,
  );
  const [row] = await db
    .select()
    .from(s.specificationDraft)
    .where(
      and(
        eq(s.specificationDraft.organizationId, f.organizationId),
        eq(s.specificationDraft.id, branchRef.draftId),
      ),
    );
  assert.ok(row?.fencedAt);
  assert.equal(
    await resolveSpecificationDraftDocument(
      db,
      specificationDraftDocumentName(branchRef),
    ),
    null,
  );
});

void test("a commit to a branch from outside its draft starts a new epoch of that draft", async () => {
  const f = await fixture("First line.\n");
  const [first] = await f.revisions();
  const branchId = crypto.randomUUID();
  await f.command({
    type: "createBranch",
    workItemId: f.workItemId,
    baseRevisionId: first!.id,
    branchId,
    name: "anna/edit",
  });
  const ref = await open(f, branchId);
  const branchHead = async () => {
    const all = await f.entities();
    const branch = all.find(
      (e): e is EntityOf<"specBranch"> =>
        e.type === "specBranch" && e.id === branchId,
    )!;
    return all.find(
      (e): e is EntityOf<"specCommit"> =>
        e.type === "specCommit" && e.id === branch.headId,
    )!;
  };
  const head = await branchHead();
  // A breakdown-only or title-only commit keeps the epoch.
  await f.command({
    type: "commitBranch",
    workItemId: f.workItemId,
    branchId,
    baseCommitId: head.id,
    title: "Renamed on the branch",
    content: head.content,
    message: "Rename",
  });
  assert.equal((await f.drafts()).find((d) => d.branchId)?.epoch, 1);
  // New content from an agent's commit replaces the draft.
  const renamed = await branchHead();
  await f.command({
    type: "commitBranch",
    workItemId: f.workItemId,
    branchId,
    baseCommitId: renamed.id,
    title: renamed.title,
    content: "Agent line.\n",
    message: "Agent change",
  });
  const draft = (await f.drafts()).find((d) => d.branchId);
  assert.equal(draft?.epoch, 2);
  assert.equal(draft?.baseCommitId, (await branchHead()).id);
  const { state } = await loadDraft(db, { ...ref, epoch: 2 });
  assert.equal(draftStateToMarkdown(state, "Agent line.\n"), "Agent line.\n");
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("the first stored edit beyond the saved cut is projected as unsaved draft changes", async () => {
  const f = await fixture("One.\n");
  const ref = await open(f);
  const writer = new DraftWriter(db, ref, canEditSpecificationDraft);
  const { state } = await loadDraft(db, ref);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const vector = Y.encodeStateVector(doc);
  appendTo(0, " Two.")(doc.getXmlFragment("default"));
  await writer.submit(f.author(f.owner), Y.encodeStateAsUpdate(doc, vector));
  doc.destroy();
  await writer.idle();
  const [draft] = await f.drafts();
  assert.equal(draft?.uncommittedChanges, true);
  // The projection a refresh wrote equals a rebuild.
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
  await seal(f, ref, 1);
  assert.equal((await f.drafts())[0]?.uncommittedChanges, false);
  assert.equal((await f.revisions()).at(-1)?.content, "One. Two.\n");
});
