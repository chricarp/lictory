import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import {
  CapabilityError,
  noEffects,
  type CapabilityContext,
} from "@lictory/core/capabilities/core";
import { invoke } from "@lictory/core/capabilities/registry";
import { DomainError } from "@lictory/core/domain/errors";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation } from "@lictory/core/domain/service";
import { documentHash } from "@lictory/core/spaces/document";
import { templateDocument } from "@lictory/core/spaces/templates";

// Work in pages against a real, disposable PostgreSQL database: a page
// created from a template starts with that content as its first version
// (and its references indexed), and decision cards read recorded decisions
// by id, archived ones included, only within the reader's organization.

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_page_work_test_${crypto.randomUUID().replaceAll("-", "")}`;
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

async function organization(owner: string, members: string[] = []) {
  const organizationId = crypto.randomUUID();
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: organizationId,
    createdAt: new Date(),
  });
  for (const [userId, role] of [
    [owner, "owner"],
    ...members.map((m) => [m, "member"]),
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
    ).summary as Record<string, string> | undefined;
  const projectId = crypto.randomUUID();
  await run(owner, {
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
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
  const spaceId = crypto.randomUUID();
  await run(owner, {
    type: "createSpace",
    spaceId,
    name: "Handbook",
    slug: `space-${spaceId.slice(0, 8)}`,
    home: { projectId },
    accessMode: "inherited",
  });
  const item = async (title: string) => {
    const workItemId = crypto.randomUUID();
    await run(owner, {
      type: "createWorkItem",
      projectId,
      workItemId,
      typeId: story!.id,
      parentId: null,
      title,
    });
    const [revision] = await db
      .select({ id: s.specificationRevision.id })
      .from(s.specificationRevision)
      .where(eq(s.specificationRevision.workItemId, workItemId));
    return { workItemId, revisionId: revision!.id };
  };
  const as = (userId: string): CapabilityContext => ({
    db,
    principal: { userId, surface: "mcp" },
    effects: noEffects,
  });
  return { organizationId, projectId, spaceId, run, item, as };
}

void test("a page created from a template publishes the template as its first version", async () => {
  const owner = await user("Owner");
  const o = await organization(owner);
  const { workItemId } = await o.item("Partial refunds");
  const content = templateDocument("iteration-notes", {
    projectId: o.projectId,
    iterationId: "iteration-1",
  });
  // A template may already mention work; its references are indexed like
  // any published content.
  content.content!.push({
    type: "paragraph",
    attrs: { id: "mention" },
    content: [{ type: "workItemRef", attrs: { workItemId, key: "PAY-1" } }],
  });
  const pageId = crypto.randomUUID();
  const summary = (await o.run(owner, {
    type: "createPage",
    spaceId: o.spaceId,
    pageId,
    title: "Sprint 4 notes",
    content: content as Record<string, never>,
  }))!;
  const [commit] = await db
    .select()
    .from(s.pageCommit)
    .where(eq(s.pageCommit.id, summary.commitId!));
  assert.deepEqual(commit!.content, content);
  assert.equal(commit!.hash, documentHash("Sprint 4 notes", content));
  assert.match(commit!.markdown, /## Goal/);
  assert.match(
    commit!.markdown,
    /\*\*Work in this iteration\*\* \(live list in Lictory\)/,
  );
  const references = await db
    .select({ target: s.pageReference.targetId })
    .from(s.pageReference)
    .where(eq(s.pageReference.pageId, pageId));
  assert.deepEqual(
    references.map((r) => r.target),
    [workItemId],
  );

  // Without content: the empty page, as before.
  const empty = (await o.run(owner, {
    type: "createPage",
    spaceId: o.spaceId,
    pageId: crypto.randomUUID(),
    title: "Blank",
  }))!;
  const [blank] = await db
    .select({ markdown: s.pageCommit.markdown })
    .from(s.pageCommit)
    .where(eq(s.pageCommit.id, empty.commitId!));
  assert.equal(blank!.markdown, "");

  // Invalid starting content is refused and creates nothing.
  const refused = crypto.randomUUID();
  await assert.rejects(
    o.run(owner, {
      type: "createPage",
      spaceId: o.spaceId,
      pageId: refused,
      title: "Broken",
      content: {
        type: "doc",
        content: [{ type: "workList", attrs: { filter: "status" } }],
      } as Record<string, never>,
    }),
    (e: unknown) => e instanceof DomainError && e.category === "validation",
  );
  assert.equal(
    (await db.select().from(s.page).where(eq(s.page.id, refused))).length,
    0,
  );
});

void test("decision cards read recorded decisions by id, archived ones included, within the organization", async () => {
  const [owner, carol, stranger] = await Promise.all(
    ["Owner", "Carol", "Stranger"].map(user),
  );
  const o = await organization(owner!, [carol!]);
  const { workItemId, revisionId } = await o.item("Retries");
  const decisionId = crypto.randomUUID();
  await o.run(owner!, {
    type: "recordDecision",
    workItemId,
    baseRevisionId: revisionId,
    decisionId,
    title: "Retries reuse the original transaction ID",
    body: "Agreed with Engineering: a retry never creates a second charge.",
  });
  const read = async (actor: string, ids: string[]) =>
    (await invoke(o.as(actor), "getDecisions", {
      organizationId: o.organizationId,
      decisionIds: ids,
    })) as {
      decisions: {
        id: string;
        title: string;
        excerpt: string;
        key: string | null;
        revisionNumber: number | null;
        archivedAt: string | null;
        href: string | null;
      }[];
    };
  // Every member reads decisions (they are work item content); unknown ids
  // are left out.
  const first = await read(carol!, [decisionId, crypto.randomUUID()]);
  assert.equal(first.decisions.length, 1);
  assert.deepEqual(
    {
      ...first.decisions[0],
      href: undefined,
    },
    {
      ...first.decisions[0],
      id: decisionId,
      title: "Retries reuse the original transaction ID",
      excerpt:
        "Agreed with Engineering: a retry never creates a second charge.",
      key: "PAY-1",
      revisionNumber: 1,
      archivedAt: null,
      href: undefined,
    },
  );
  assert.equal(first.decisions[0]!.href, `/${o.organizationId}/items/PAY-1`);

  // Archived: still readable, marked as withdrawn.
  await o.run(owner!, {
    type: "setDecisionArchived",
    workItemId,
    decisionId,
    archived: true,
  });
  const archived = await read(owner!, [decisionId]);
  assert.ok(archived.decisions[0]!.archivedAt);

  // Another organization's member learns nothing, not even that it exists.
  await assert.rejects(
    read(stranger!, [decisionId]),
    (e: unknown) => e instanceof CapabilityError,
  );
  const other = await organization(stranger!);
  const none = (await invoke(other.as(stranger!), "getDecisions", {
    organizationId: other.organizationId,
    decisionIds: [decisionId],
  })) as { decisions: unknown[] };
  assert.deepEqual(none.decisions, []);
});
