import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import {
  PROTOCOL,
  knowledgeEntityTypes,
  mutationSchema,
  type Command,
  type SpaceEntity,
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
import {
  rebuildReferenceIndex,
  referenceIndexDrift,
} from "@lictory/core/spaces/knowledge";
import {
  canonicalizeDocument,
  documentHash,
  documentToMarkdown,
} from "@lictory/core/spaces/document";

// Knowledge links between pages and work (docs/internals/knowledge-links.md)
// against a real, disposable PostgreSQL database: the reference index
// follows main's head, specification citations follow revisions, links need
// both permissions, and nothing of a page reaches someone who cannot read
// its space.

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_knowledge_test_${crypto.randomUUID().replaceAll("-", "")}`;
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
type Node = Record<string, unknown>;

const text = (value: string): Node => ({ type: "text", text: value });
const paragraph = (id: string, ...content: Node[]): Node => ({
  type: "paragraph",
  attrs: { id },
  content,
});
const itemRef = (workItemId: string, key = "PAY-1"): Node => ({
  type: "workItemRef",
  attrs: { workItemId, key },
});
const pageRef = (pageId: string, commitId?: string): Node => ({
  type: "pageRef",
  attrs: commitId ? { pageId, commitId } : { pageId },
});
const decisionRef = (decisionId: string, label: string): Node => ({
  type: "decisionRef",
  attrs: { decisionId, label },
});
const doc = (...content: Node[]) => ({ type: "doc", content });

// An organization with one project and two spaces homed in it:
// - owner: organization owner, project administrator, Product (all
//   capabilities), editor of both spaces;
// - alice: project member in Engineering (changes properties), reads the
//   restricted space through a view grant;
// - bob: project member without a discipline;
// - carol: organization member only;
// - dave: project member in Engineering, no access to the restricted space.
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
  const run = async (actor: string, command: Command, mutationId?: string) =>
    (
      await executeMutation(
        db,
        { userId: actor },
        {
          protocol: PROTOCOL,
          id: mutationId ?? crypto.randomUUID(),
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
  const [engineering] = await db
    .select({ id: s.discipline.id })
    .from(s.discipline)
    .where(
      and(
        eq(s.discipline.organizationId, organizationId),
        eq(s.discipline.projectId, projectId),
        eq(s.discipline.name, "Engineering"),
      ),
    );
  for (const member of [alice!, dave!])
    await run(owner!, {
      type: "setDisciplineMember",
      projectId,
      disciplineId: engineering!.id,
      userId: member,
      member: true,
    });
  await run(owner!, {
    type: "setProjectMember",
    projectId,
    userId: bob!,
    role: "member",
  });
  const [story] = await db
    .select({ id: s.workItemType.id })
    .from(s.workItemType)
    .where(
      and(
        eq(s.workItemType.organizationId, organizationId),
        eq(s.workItemType.name, "Story"),
      ),
    );
  const space = async (accessMode: "inherited" | "restricted") => {
    const spaceId = crypto.randomUUID();
    await run(owner!, {
      type: "createSpace",
      spaceId,
      name: accessMode === "restricted" ? "Security" : "Handbook",
      slug: `space-${spaceId.slice(0, 8)}`,
      home: { projectId },
      accessMode,
    });
    return spaceId;
  };
  const openSpace = await space("inherited");
  const secretSpace = await space("restricted");
  await run(owner!, {
    type: "setSpaceGrant",
    spaceId: secretSpace,
    userId: alice!,
    level: "view",
  });
  const page = async (spaceId: string, title: string) =>
    (await run(owner!, {
      type: "createPage",
      spaceId,
      pageId: crypto.randomUUID(),
      title,
    })) as { pageId: string; mainBranchId: string; commitId: string };
  const item = async (title: string, description = "", actor = owner!) => {
    const workItemId = crypto.randomUUID();
    await run(actor, {
      type: "createWorkItem",
      projectId,
      workItemId,
      typeId: story!.id,
      parentId: null,
      title,
      description,
    });
    return workItemId;
  };
  const mainHead = async (pageId: string) =>
    (
      await db
        .select({ head: s.pageBranch.headCommitId })
        .from(s.pageBranch)
        .where(
          and(eq(s.pageBranch.pageId, pageId), eq(s.pageBranch.isMain, true)),
        )
    )[0]!.head;
  // Proposes content on a branch; `merge` publishes it into main.
  const propose = async (
    pageId: string,
    content: Node,
    origin?: { workItemId: string; revisionId: string },
  ) => {
    const branchId = crypto.randomUUID();
    const pullRequestId = crypto.randomUUID();
    const [published] = await db
      .select({ title: s.pageCommit.title })
      .from(s.pageCommit)
      .where(eq(s.pageCommit.id, await mainHead(pageId)));
    const proposed = (await run(owner!, {
      type: "proposePageChange",
      pageId,
      branchId,
      pullRequestId,
      title: published!.title,
      content: content as Record<string, never>,
      message: `Change ${branchId.slice(0, 6)}`,
      ...(origin ? { origin } : {}),
    }))!;
    const merge = async () =>
      (await run(owner!, {
        type: "mergePagePullRequest",
        pullRequestId,
        inspectedSourceHead: proposed.commitId!,
        inspectedTargetHead: await mainHead(pageId),
      }))!.commitId!;
    return { branchId, pullRequestId, commitId: proposed.commitId!, merge };
  };
  const publish = async (pageId: string, content: Node) =>
    (await propose(pageId, content)).merge();
  const latestRevision = async (workItemId: string) =>
    (
      await db
        .select({
          id: s.specificationRevision.id,
          number: s.specificationRevision.number,
        })
        .from(s.specificationRevision)
        .where(eq(s.specificationRevision.workItemId, workItemId))
    ).sort((a, b) => b.number - a.number)[0]!.id;
  const as = (userId: string): CapabilityContext => ({
    db,
    principal: { userId, surface: "mcp" },
    effects: noEffects,
  });
  return {
    organizationId,
    projectId,
    owner: owner!,
    alice: alice!,
    bob: bob!,
    carol: carol!,
    dave: dave!,
    openSpace,
    secretSpace,
    run,
    page,
    item,
    propose,
    publish,
    mainHead,
    latestRevision,
    as,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function rejects(
  promise: Promise<unknown>,
  category: DomainError["category"],
  message?: RegExp,
) {
  await assert.rejects(promise, (error) => {
    const e = error as DomainError | CapabilityError;
    assert.ok(
      error instanceof DomainError || error instanceof CapabilityError,
      String(error),
    );
    assert.equal(e.category, category, e.message);
    if (message) assert.match(e.message, message);
    return true;
  });
}

// Knowledge projection rows of the organization, by type.
async function knowledge(f: Fixture) {
  const rows = await db
    .select()
    .from(s.spaceEntity)
    .where(
      and(
        eq(s.spaceEntity.organizationId, f.organizationId),
        inArray(s.spaceEntity.type, [...knowledgeEntityTypes]),
      ),
    );
  return rows;
}
const ofType = <T extends SpaceEntity["type"]>(
  rows: { type: string; data: unknown }[],
  type: T,
) =>
  rows
    .filter((r) => r.type === type)
    .map((r) => r.data as Extract<SpaceEntity, { type: T }>);

async function invariant(f: Fixture) {
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
  assert.deepEqual(await referenceIndexDrift(db, f.organizationId), []);
}

void test("pinned page references and decision references are valid canonical content; unpinned ones keep their form", () => {
  const unpinned = canonicalizeDocument(doc(paragraph("a", pageRef("p1"))));
  assert.deepEqual(
    (unpinned.content![0]!.content![0] as Node).attrs,
    { pageId: "p1" },
    "documents written before pins existed keep their canonical JSON",
  );
  assert.equal(
    documentHash("T", unpinned),
    documentHash("T", doc(paragraph("a", pageRef("p1")))),
  );
  const pinned = canonicalizeDocument(
    doc(
      paragraph("a", pageRef("p1", "c1"), decisionRef("d1", "Retries reuse")),
    ),
  );
  assert.deepEqual((pinned.content![0]!.content![0] as Node).attrs, {
    pageId: "p1",
    commitId: "c1",
  });
  assert.match(documentToMarkdown(pinned), /\(page:p1@c1\)/);
  assert.match(documentToMarkdown(pinned), /\[Retries reuse\]\(decision:d1\)/);
  assert.throws(() =>
    canonicalizeDocument(doc(paragraph("a", decisionRef("", "x")))),
  );
});

void test("the reference index follows main's head: branch-only references wait for the merge, restores and archives follow", async () => {
  const f = await fixture();
  const workItemId = await f.item("Refund retries");
  const {
    pageId,
    mainBranchId,
    commitId: initial,
  } = await f.page(f.openSpace, "Refund runbook");
  const content = doc(
    paragraph("b1", text("Retries: "), itemRef(workItemId)),
    paragraph("b2", text("See also "), itemRef(workItemId)),
  );
  const proposal = await f.propose(pageId, content);
  // On a branch only: nothing is indexed or projected.
  assert.equal(
    (
      await db
        .select()
        .from(s.pageReference)
        .where(eq(s.pageReference.pageId, pageId))
    ).length,
    0,
  );
  assert.equal(ofType(await knowledge(f), "pageReference").length, 0);
  const merged = await proposal.merge();
  const references = ofType(await knowledge(f), "pageReference");
  assert.equal(references.length, 1);
  assert.deepEqual(
    {
      pageId: references[0]!.pageId,
      workItemId: references[0]!.workItemId,
      commitId: references[0]!.commitId,
      blockIds: references[0]!.blockIds,
      spaceId: references[0]!.spaceId,
    },
    {
      pageId,
      workItemId,
      commitId: merged,
      blockIds: ["b1", "b2"],
      spaceId: f.openSpace,
    },
  );
  const [stored] = await db
    .select()
    .from(s.spaceEntity)
    .where(eq(s.spaceEntity.key, `pageReference:${pageId}:${workItemId}`));
  assert.equal(stored!.workItemId, workItemId);
  assert.equal(stored!.pageId, pageId);
  await invariant(f);

  // Restoring the empty first version on main removes the reference.
  await f.run(f.owner, {
    type: "restorePageCommit",
    pageId,
    branchId: mainBranchId,
    commitId: initial,
    expectedHead: merged,
  });
  assert.equal(ofType(await knowledge(f), "pageReference").length, 0);
  await invariant(f);
  // Restoring the referencing version brings it back.
  await f.run(f.owner, {
    type: "restorePageCommit",
    pageId,
    branchId: mainBranchId,
    commitId: merged,
    expectedHead: await f.mainHead(pageId),
  });
  assert.equal(ofType(await knowledge(f), "pageReference").length, 1);

  // Archived pages keep their index rows; readers no longer see them.
  await f.run(f.owner, { type: "archivePage", pageId, archived: true });
  assert.equal(ofType(await knowledge(f), "pageReference").length, 0);
  assert.equal(
    (
      await db
        .select()
        .from(s.pageReference)
        .where(eq(s.pageReference.pageId, pageId))
    ).length,
    2,
  );
  const hidden = (await invoke(f.as(f.alice), "getWorkItemKnowledge", {
    organizationId: f.organizationId,
    workItemId,
  })) as { referencedIn: unknown[] };
  assert.equal(hidden.referencedIn.length, 0);
  await invariant(f);
  await f.run(f.owner, { type: "archivePage", pageId, archived: false });
  assert.equal(ofType(await knowledge(f), "pageReference").length, 1);
  // Archiving the space hides them too.
  await f.run(f.owner, {
    type: "archiveSpace",
    spaceId: f.openSpace,
    archived: true,
  });
  assert.equal(ofType(await knowledge(f), "pageReference").length, 0);
  await f.run(f.owner, {
    type: "archiveSpace",
    spaceId: f.openSpace,
    archived: false,
  });
  assert.equal(ofType(await knowledge(f), "pageReference").length, 1);
  await invariant(f);
});

void test("specification citations follow revisions, keep pinned versions and are listed on the page", async () => {
  const f = await fixture();
  const { pageId, commitId: firstVersion } = await f.page(
    f.openSpace,
    "Payments service",
  );
  const decisionItem = await f.item("Decision holder");
  const workItemId = await f.item(
    "Refunds",
    `Follow [Payments service](page:${pageId}@${firstVersion}) and [Payments service](page:${pageId}). Related [PAY-1](item:${decisionItem}).`,
  );
  let citations = ofType(await knowledge(f), "specificationCitation");
  assert.equal(citations.length, 1);
  assert.equal(citations[0]!.workItemId, workItemId);
  assert.equal(citations[0]!.pageId, pageId);
  assert.deepEqual(
    citations[0]!.revisions.map((r) => ({
      number: r.number,
      commitIds: r.commitIds,
      latest: r.latest,
    })),
    [{ number: 1, commitIds: [firstVersion], latest: true }],
  );
  // A new revision without the citation: history keeps revision 1.
  await f.run(f.owner, {
    type: "updateSpecification",
    workItemId,
    baseRevisionId: await f.latestRevision(workItemId),
    title: "Refunds",
    content: "No page anymore.",
  });
  citations = ofType(await knowledge(f), "specificationCitation");
  assert.equal(citations[0]!.revisions.length, 1);
  const knowledgeOfItem = (await invoke(f.as(f.carol), "getWorkItemKnowledge", {
    organizationId: f.organizationId,
    workItemId,
  })) as {
    citations: {
      pageId: string;
      title: string;
      citedByCurrentRevision: boolean;
    }[];
  };
  assert.equal(knowledgeOfItem.citations.length, 1);
  assert.equal(knowledgeOfItem.citations[0]!.title, "Payments service");
  assert.equal(knowledgeOfItem.citations[0]!.citedByCurrentRevision, false);
  const work = (await invoke(f.as(f.carol), "listPageWork", {
    organizationId: f.organizationId,
    pageId,
  })) as { citedBy: { workItemId: string; key: string }[] };
  assert.deepEqual(
    work.citedBy.map((c) => c.workItemId),
    [workItemId],
  );
  // Item references in specifications are indexed too.
  const toItem = (await invoke(f.as(f.carol), "listReferencesTo", {
    organizationId: f.organizationId,
    kind: "item",
    id: decisionItem,
  })) as {
    specifications: { workItemId: string; citedByCurrentRevision: boolean }[];
  };
  assert.deepEqual(
    toItem.specifications.map((x) => [x.workItemId, x.citedByCurrentRevision]),
    [[workItemId, false]],
  );
  await invariant(f);
});

void test("a restricted page never reaches someone who cannot read its space: no row, title or count", async () => {
  const f = await fixture();
  const workItemId = await f.item("Token rotation");
  const secret = await f.page(f.secretSpace, "Incident 42 analysis");
  const open = await f.page(f.openSpace, "Public notes");
  await f.publish(secret.pageId, doc(paragraph("s1", itemRef(workItemId))));
  await f.publish(
    open.pageId,
    doc(paragraph("o1", itemRef(workItemId), pageRef(secret.pageId))),
  );
  await f.run(f.owner, {
    type: "attachPage",
    workItemId,
    attachmentId: crypto.randomUUID(),
    pageId: secret.pageId,
    purpose: "background",
  });
  await f.run(f.owner, {
    type: "linkContextPage",
    projectId: f.projectId,
    linkId: crypto.randomUUID(),
    pageId: secret.pageId,
  });
  // Every knowledge row of the secret page authorizes through its space.
  for (const row of await knowledge(f))
    if (row.pageId === secret.pageId) assert.equal(row.spaceId, f.secretSpace);
  const readerCount = async (spaceId: string, userId: string) =>
    (
      await db
        .select()
        .from(s.spaceReader)
        .where(
          and(
            eq(s.spaceReader.spaceId, spaceId),
            eq(s.spaceReader.userId, userId),
          ),
        )
    ).length;
  assert.equal(await readerCount(f.secretSpace, f.carol), 0);
  assert.equal(await readerCount(f.secretSpace, f.alice), 1);

  const outsider = f.as(f.carol);
  const seen = JSON.stringify(
    await Promise.all([
      invoke(outsider, "getWorkItemKnowledge", {
        organizationId: f.organizationId,
        workItemId,
      }),
      invoke(outsider, "listReferencesTo", {
        organizationId: f.organizationId,
        kind: "item",
        id: workItemId,
      }),
      invoke(outsider, "listContextPages", {
        organizationId: f.organizationId,
        projectId: f.projectId,
        all: true,
      }),
      invoke(outsider, "listPageWork", {
        organizationId: f.organizationId,
        pageId: open.pageId,
      }),
    ]),
  );
  assert.ok(!seen.includes(secret.pageId), seen);
  assert.ok(!seen.includes("Incident 42"), seen);
  assert.ok(!seen.includes(f.secretSpace), seen);
  const knowledgeOfItem = (await invoke(outsider, "getWorkItemKnowledge", {
    organizationId: f.organizationId,
    workItemId,
  })) as { referencedIn: { pageId: string }[]; attachments: unknown[] };
  assert.deepEqual(
    knowledgeOfItem.referencedIn.map((r) => r.pageId),
    [open.pageId],
  );
  assert.equal(knowledgeOfItem.attachments.length, 0);
  for (const name of ["listPageWork"] as const)
    await rejects(
      invoke(outsider, name, {
        organizationId: f.organizationId,
        pageId: secret.pageId,
      }),
      "not_found",
    );
  await rejects(
    invoke(outsider, "listReferencesTo", {
      organizationId: f.organizationId,
      kind: "page",
      id: secret.pageId,
    }),
    "not_found",
  );
  // A reader of the restricted space sees all of it.
  const reader = (await invoke(f.as(f.alice), "getWorkItemKnowledge", {
    organizationId: f.organizationId,
    workItemId,
  })) as {
    referencedIn: { pageId: string; title: string }[];
    attachments: { pageId: string; purpose: string }[];
  };
  assert.deepEqual(reader.referencedIn.map((r) => r.title).sort(), [
    "Incident 42 analysis",
    "Public notes",
  ]);
  assert.deepEqual(
    reader.attachments.map((a) => [a.pageId, a.purpose]),
    [[secret.pageId, "background"]],
  );
  const context = (await invoke(f.as(f.alice), "listContextPages", {
    organizationId: f.organizationId,
    projectId: f.projectId,
  })) as { pages: { title: string }[] };
  assert.deepEqual(
    context.pages.map((p) => p.title),
    ["Incident 42 analysis"],
  );
  // Losing access removes everything at once.
  await f.run(f.owner, {
    type: "setSpaceGrant",
    spaceId: f.secretSpace,
    userId: f.alice,
    level: null,
  });
  const revoked = JSON.stringify(
    await invoke(f.as(f.alice), "getWorkItemKnowledge", {
      organizationId: f.organizationId,
      workItemId,
    }),
  );
  assert.ok(!revoked.includes(secret.pageId), revoked);
  await invariant(f);
});

void test("attaching a page needs change-properties and read access, and is reversible", async () => {
  const f = await fixture();
  const workItemId = await f.item("Chargebacks");
  const secret = await f.page(f.secretSpace, "Fraud rules");
  const open = await f.page(f.openSpace, "Chargeback design");
  const attach = (
    actor: string,
    pageId: string,
    extra: Partial<Command> = {},
  ) =>
    f.run(actor, {
      type: "attachPage",
      workItemId,
      attachmentId: crypto.randomUUID(),
      pageId,
      purpose: "design",
      ...extra,
    } as Command);
  // No discipline that changes properties.
  await rejects(attach(f.bob, open.pageId), "forbidden", /item properties/);
  await rejects(attach(f.carol, open.pageId), "forbidden");
  // Changes properties but cannot read the page: as if it did not exist.
  await rejects(attach(f.dave, secret.pageId), "not_found", /unavailable/);
  await rejects(
    attach(f.alice, crypto.randomUUID()),
    "not_found",
    /unavailable/,
  );
  // A pin must be a version of that page.
  await rejects(
    attach(f.alice, open.pageId, {
      commitId: secret.commitId,
    }),
    "not_found",
  );
  const first = await attach(f.alice, secret.pageId, {
    commitId: secret.commitId,
  });
  let attachments = ofType(await knowledge(f), "pageAttachment");
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0]!.commitId, secret.commitId);
  assert.equal(attachments[0]!.spaceId, f.secretSpace);
  await rejects(
    attach(f.alice, secret.pageId, {
      commitId: secret.commitId,
    }),
    "validation",
    /Nothing to change/,
  );
  // A new purpose replaces the attachment and keeps the old row.
  const replaced = await f.run(f.alice, {
    type: "attachPage",
    workItemId,
    attachmentId: crypto.randomUUID(),
    pageId: secret.pageId,
    purpose: "runbook",
  });
  assert.equal(replaced!.replacedAttachmentId, first!.attachmentId);
  attachments = ofType(await knowledge(f), "pageAttachment");
  assert.deepEqual(
    attachments.map((a) => [a.purpose, a.commitId]),
    [["runbook", null]],
  );
  // Detaching: dave cannot (cannot read), bob cannot (no capability).
  await rejects(
    f.run(f.dave, {
      type: "detachPage",
      workItemId,
      attachmentId: replaced!.attachmentId!,
    }),
    "not_found",
  );
  await rejects(
    f.run(f.bob, {
      type: "detachPage",
      workItemId,
      attachmentId: replaced!.attachmentId!,
    }),
    "not_found",
  );
  await f.run(f.alice, {
    type: "detachPage",
    workItemId,
    attachmentId: replaced!.attachmentId!,
  });
  assert.equal(ofType(await knowledge(f), "pageAttachment").length, 0);
  const rows = await db
    .select()
    .from(s.workItemPageAttachment)
    .where(eq(s.workItemPageAttachment.workItemId, workItemId));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.detachedAt && r.detachedById === f.alice));
  // Attaching again restores it.
  await attach(f.alice, secret.pageId);
  assert.equal(ofType(await knowledge(f), "pageAttachment").length, 1);
  // The history is the page's, visible to its readers only.
  const activity = await db
    .select({ action: s.pageActivity.action })
    .from(s.pageActivity)
    .where(eq(s.pageActivity.pageId, secret.pageId));
  assert.deepEqual(
    activity.map((a) => a.action).filter((a) => a.startsWith("page_")),
    [
      "page_attached",
      "page_detached",
      "page_attached",
      "page_detached",
      "page_attached",
    ],
  );
  // An item's activity never mentions the restricted page.
  const itemActivity = JSON.stringify(
    await db
      .select()
      .from(s.activity)
      .where(eq(s.activity.workItemId, workItemId)),
  );
  assert.ok(!itemActivity.includes(secret.pageId));
  await invariant(f);
});

void test("work created from a page records validated, immutable provenance", async () => {
  const f = await fixture();
  const secret = await f.page(f.secretSpace, "Abuse cases");
  const open = await f.page(f.openSpace, "Missing refund runbook");
  const published = await f.publish(
    open.pageId,
    doc(
      paragraph("blk", text("Refunds after settlement are undefined.")),
      paragraph(
        "blk2",
        text("Chargebacks follow "),
        {
          type: "workItemRef",
          attrs: { workItemId: crypto.randomUUID(), key: "HW-9" },
        },
        text(" and the card network."),
      ),
    ),
  );
  const typeId = async (name: string) =>
    (
      await db
        .select({ id: s.workItemType.id })
        .from(s.workItemType)
        .where(
          and(
            eq(s.workItemType.organizationId, f.organizationId),
            eq(s.workItemType.name, name),
          ),
        )
    )[0]!.id;
  const story = { id: await typeId("Story") };
  const task = await typeId("Task");
  const create = (
    actor: string,
    source: Record<string, unknown>,
    workItemId = crypto.randomUUID(),
    mutationId?: string,
  ) =>
    f.run(
      actor,
      {
        type: "createWorkItem",
        projectId: f.projectId,
        workItemId,
        // Plain work: Engineering (change properties) may create it.
        typeId: actor === f.dave ? task : story.id,
        parentId: null,
        title: "Define refunds after settlement",
        source,
      } as Command,
      mutationId,
    );
  // The commit must belong to the page, the block to that commit.
  await rejects(
    create(f.owner, { pageId: open.pageId, commitId: secret.commitId }),
    "not_found",
    /version/,
  );
  await rejects(
    create(f.owner, {
      pageId: open.pageId,
      commitId: published,
      blockId: "missing",
    }),
    "validation",
    /block/,
  );
  // The quote must be that version's text: an invented quote, or one from
  // another block, is refused (and nothing is created).
  const invented = crypto.randomUUID();
  await rejects(
    create(
      f.owner,
      {
        pageId: open.pageId,
        commitId: published,
        quote: "Refunds after settlement are free.",
      },
      invented,
    ),
    "validation",
    /not text of that version/,
  );
  await rejects(
    create(f.owner, {
      pageId: open.pageId,
      commitId: published,
      blockId: "blk",
      quote: "Chargebacks follow",
    }),
    "validation",
    /starting in that block/,
  );
  assert.equal(
    (await db.select().from(s.workItem).where(eq(s.workItem.id, invented)))
      .length,
    0,
  );
  // Reading the space is required: dave could create the item but cannot
  // read the page, and nothing is created.
  const refused = crypto.randomUUID();
  await rejects(
    create(
      f.dave,
      { pageId: secret.pageId, commitId: secret.commitId },
      refused,
    ),
    "not_found",
  );
  assert.equal(
    (await db.select().from(s.workItem).where(eq(s.workItem.id, refused)))
      .length,
    0,
  );
  // The quote is bounded.
  assert.equal(
    mutationSchema.safeParse({
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId: f.organizationId,
      command: {
        type: "createWorkItem",
        projectId: f.projectId,
        workItemId: crypto.randomUUID(),
        typeId: story.id,
        parentId: null,
        title: "Too long",
        source: {
          pageId: open.pageId,
          commitId: published,
          quote: "x".repeat(2001),
        },
      },
    }).success,
    false,
  );
  const workItemId = crypto.randomUUID();
  const mutationId = crypto.randomUUID();
  const source = {
    pageId: open.pageId,
    commitId: published,
    blockId: "blk",
    quote: "Refunds after settlement are undefined.",
  };
  await create(f.owner, source, workItemId, mutationId);
  // Idempotent with the mutation id: a retry writes nothing more.
  await create(f.owner, source, workItemId, mutationId);
  const stored = await db
    .select()
    .from(s.workItemPageSource)
    .where(eq(s.workItemPageSource.workItemId, workItemId));
  assert.equal(stored.length, 1);
  const [projected] = ofType(await knowledge(f), "workItemSource");
  assert.deepEqual(
    {
      workItemId: projected!.workItemId,
      pageId: projected!.pageId,
      commitId: projected!.commitId,
      blockId: projected!.blockId,
      quote: projected!.quote,
    },
    { workItemId, ...source },
  );
  // Never on the organization-wide item projection.
  const itemRows = JSON.stringify(
    await db
      .select()
      .from(s.syncEntity)
      .where(eq(s.syncEntity.organizationId, f.organizationId)),
  );
  assert.ok(!itemRows.includes(open.pageId));
  const work = (await invoke(f.as(f.carol), "listPageWork", {
    organizationId: f.organizationId,
    pageId: open.pageId,
  })) as { createdItems: { workItemId: string; blockId: string }[] };
  assert.deepEqual(
    work.createdItems.map((c) => [c.workItemId, c.blockId]),
    [[workItemId, "blk"]],
  );
  // Whitespace and block boundaries are not words: a selection across two
  // blocks quotes from its first, with references as readers copy them.
  for (const [blockId, quote] of [
    ["blk", "after settlement are   undefined.\n\nChargebacks follow HW-9 and"],
    ["blk2", "Chargebacks follow  and the card network."],
  ])
    await create(f.owner, {
      pageId: open.pageId,
      commitId: published,
      blockId,
      quote,
    });
  await invariant(f);
});

void test("page branches remember the work item revision they were proposed from, after merge too", async () => {
  const f = await fixture();
  const workItemId = await f.item("Refund retries", "Retries reuse the ID.");
  const other = await f.item("Other");
  const revisionId = await f.latestRevision(workItemId);
  const { pageId } = await f.page(f.openSpace, "Refund runbook");
  // A revision of another item is not this item's.
  await rejects(
    f.run(f.owner, {
      type: "createPageBranch",
      pageId,
      branchId: crypto.randomUUID(),
      name: "wrong-origin",
      origin: { workItemId: other, revisionId },
    }),
    "not_found",
  );
  const branchId = crypto.randomUUID();
  await f.run(f.owner, {
    type: "createPageBranch",
    pageId,
    branchId,
    name: "document-retries",
    origin: { workItemId, revisionId },
  });
  const proposal = await f.propose(
    pageId,
    doc(paragraph("r1", text("Retries reuse the original ID."))),
    { workItemId, revisionId },
  );
  let origins = ofType(await knowledge(f), "pageBranchOrigin");
  assert.deepEqual(
    origins.map((o) => o.branchId).sort(),
    [branchId, proposal.branchId].sort(),
  );
  const merged = await proposal.merge();
  origins = ofType(await knowledge(f), "pageBranchOrigin");
  const proposed = origins.find((o) => o.branchId === proposal.branchId)!;
  assert.equal(proposed.workItemId, workItemId);
  assert.equal(proposed.revisionId, revisionId);
  // Readers name the change by its pull request and the revision it came
  // from, not by the branch.
  assert.equal(proposed.revisionNumber, 1);
  assert.ok(proposed.deletedAt, "the merged source branch is retired");
  assert.deepEqual(proposed.pullRequests, [
    {
      id: proposal.pullRequestId,
      title: `Change ${proposal.branchId.slice(0, 6)}`,
      status: "merged",
      targetBranchId: proposed.pullRequests[0]!.targetBranchId,
      mergeCommitId: merged,
    },
  ]);
  const knowledgeOfItem = (await invoke(f.as(f.carol), "getWorkItemKnowledge", {
    organizationId: f.organizationId,
    workItemId,
  })) as { pageBranches: { branchId: string; title: string }[] };
  assert.equal(knowledgeOfItem.pageBranches.length, 2);
  await invariant(f);
});

void test("context pages: who may link them, order, unlink and relink", async () => {
  const f = await fixture();
  const a = await f.page(f.openSpace, "Board conventions");
  const b = await f.page(f.openSpace, "Payments architecture");
  const c = await f.page(f.openSpace, "Glossary");
  const teamId = crypto.randomUUID();
  await f.run(f.owner, {
    type: "createTeam",
    projectId: f.projectId,
    teamId,
    name: "Refunds",
  });
  const iterationId = crypto.randomUUID();
  await f.run(f.owner, {
    type: "createIteration",
    projectId: f.projectId,
    iterationId,
    name: "Sprint 1",
    goal: null,
    startsAt: "2026-11-02",
    endsAt: "2026-11-16",
  });
  const link = (
    actor: string,
    pageId: string,
    extra: Record<string, unknown> = {},
  ) =>
    f.run(actor, {
      type: "linkContextPage",
      projectId: f.projectId,
      linkId: crypto.randomUUID(),
      pageId,
      ...extra,
    });
  // Project members without a discipline that changes properties, and
  // people outside the project, cannot.
  await rejects(link(f.bob, a.pageId), "forbidden", /context pages/);
  await rejects(link(f.carol, a.pageId), "forbidden");
  // Project administrators and property changers can.
  const first = (await link(f.owner, a.pageId))!.linkId!;
  const second = (await link(f.alice, b.pageId))!.linkId!;
  const front = (await link(f.alice, c.pageId, { beforeId: first }))!.linkId!;
  await rejects(link(f.alice, a.pageId), "conflict", /already/);
  // The same page may be context of a team and of an iteration.
  await link(f.alice, a.pageId, { teamId });
  await link(f.alice, a.pageId, { iterationId });
  await rejects(link(f.alice, b.pageId, { teamId, iterationId }), "validation");
  await rejects(
    link(f.alice, b.pageId, { teamId: crypto.randomUUID() }),
    "not_found",
  );
  const order = async () =>
    (
      (await invoke(f.as(f.carol), "listContextPages", {
        organizationId: f.organizationId,
        projectId: f.projectId,
      })) as { pages: { linkId: string; title: string }[] }
    ).pages.map((p) => p.title);
  assert.deepEqual(await order(), [
    "Glossary",
    "Board conventions",
    "Payments architecture",
  ]);
  const team = (await invoke(f.as(f.carol), "listContextPages", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    teamId,
  })) as { pages: { title: string }[] };
  assert.deepEqual(
    team.pages.map((p) => p.title),
    ["Board conventions"],
  );
  await f.run(f.alice, {
    type: "moveContextPage",
    projectId: f.projectId,
    linkId: front,
    afterId: second,
    beforeId: null,
  });
  assert.deepEqual(await order(), [
    "Board conventions",
    "Payments architecture",
    "Glossary",
  ]);
  await rejects(
    f.run(f.bob, {
      type: "unlinkContextPage",
      projectId: f.projectId,
      linkId: second,
    }),
    "forbidden",
  );
  await f.run(f.alice, {
    type: "unlinkContextPage",
    projectId: f.projectId,
    linkId: second,
  });
  assert.deepEqual(await order(), ["Board conventions", "Glossary"]);
  await link(f.alice, b.pageId);
  assert.deepEqual(await order(), [
    "Board conventions",
    "Glossary",
    "Payments architecture",
  ]);
  const projected = ofType(await knowledge(f), "pageContextLink");
  assert.equal(projected.length, 5);
  const [row] = await db
    .select()
    .from(s.spaceEntity)
    .where(eq(s.spaceEntity.key, `pageContextLink:${first}`));
  assert.equal(row!.projectId, f.projectId);

  // Iteration notes: a new page linked in the same command, both or
  // neither. Bob edits the space but does not manage context pages, so
  // nothing of his attempt exists.
  const notes = (actor: string, pageId: string) =>
    ({
      type: "createPage",
      spaceId: f.openSpace,
      pageId,
      title: "Sprint 1 notes",
      contextLink: {
        projectId: f.projectId,
        linkId: crypto.randomUUID(),
        iterationId,
      },
    }) as Command;
  const refusedPage = crypto.randomUUID();
  await rejects(
    f.run(f.bob, notes(f.bob, refusedPage)),
    "forbidden",
    /context pages/,
  );
  assert.equal(
    (await db.select().from(s.page).where(eq(s.page.id, refusedPage))).length,
    0,
  );
  // A retry of the same mutation (its answer was lost) creates one page
  // and one link.
  const notesPage = crypto.randomUUID();
  const command = notes(f.alice, notesPage);
  const mutationId = crypto.randomUUID();
  await f.run(f.alice, command, mutationId);
  await f.run(f.alice, command, mutationId);
  const linked = await db
    .select()
    .from(s.pageContextLink)
    .where(eq(s.pageContextLink.pageId, notesPage));
  assert.equal(linked.length, 1);
  assert.equal(linked[0]!.iterationId, iterationId);
  assert.equal(
    (await db.select().from(s.page).where(eq(s.page.id, notesPage))).length,
    1,
  );
  await invariant(f);
});

void test("the reference index always equals a rebuild from stored commits and revisions", async () => {
  const f = await fixture();
  const one = await f.item("One");
  const two = await f.item("Two");
  const target = await f.page(f.openSpace, "Target");
  const source = await f.page(f.openSpace, "Source");
  const secret = await f.page(f.secretSpace, "Secret");
  const v1 = await f.publish(
    source.pageId,
    doc(
      paragraph("x1", itemRef(one), pageRef(target.pageId, target.commitId)),
      paragraph("x2", itemRef(two), pageRef(target.pageId)),
    ),
  );
  await invariant(f);
  // A branch that never merges changes nothing.
  await f.propose(source.pageId, doc(paragraph("x3", itemRef(two))));
  await invariant(f);
  await f.publish(secret.pageId, doc(paragraph("y1", itemRef(one))));
  await f.run(f.owner, {
    type: "restorePageCommit",
    pageId: source.pageId,
    branchId: source.mainBranchId,
    commitId: source.commitId,
    expectedHead: v1,
  });
  await invariant(f);
  await f.run(f.owner, {
    type: "updateSpecification",
    workItemId: one,
    baseRevisionId: await f.latestRevision(one),
    title: "One",
    content: `Cites [Target](page:${target.pageId}@${target.commitId}) and [Two](item:${two}).`,
  });
  await f.run(f.owner, {
    type: "archivePage",
    pageId: secret.pageId,
    archived: true,
  });
  await invariant(f);
  // Losing the index (an older release, a repair) is rebuilt exactly.
  await db
    .delete(s.pageReference)
    .where(eq(s.pageReference.organizationId, f.organizationId));
  await db
    .delete(s.specificationReference)
    .where(eq(s.specificationReference.organizationId, f.organizationId));
  assert.notDeepEqual(await referenceIndexDrift(db, f.organizationId), []);
  const dry = await rebuildReferenceIndex(db, f.organizationId, {
    dryRun: true,
  });
  assert.ok(dry.pagesChanged > 0 && dry.itemsChanged > 0);
  assert.notDeepEqual(await referenceIndexDrift(db, f.organizationId), []);
  const result = await rebuildReferenceIndex(db, f.organizationId);
  assert.equal(result.pagesChanged, dry.pagesChanged);
  await invariant(f);
  const again = await rebuildReferenceIndex(db, f.organizationId);
  assert.equal(again.pagesChanged + again.itemsChanged, 0);
});
