import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation } from "@lictory/core/domain/service";
import { queries } from "@lictory/zero/queries";
import { schema } from "@lictory/zero/schema";

// The knowledge link queries (docs/internals/knowledge-links.md), compiled by
// Zero to SQL and run against a disposable database: a work item, a page or
// a project receives the rows of pages its reader can read, and nothing
// (not even a count) of the others.

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_knowledge_query_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 4, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
const zql = zeroDrizzle(schema, db);
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

type Row = { key?: string; type?: string; spaceId?: string; pageId?: string };
async function subscribe(
  name: keyof typeof queries,
  userID: string,
  args: Record<string, string>,
) {
  const query = (
    queries[name] as unknown as {
      fn: (input: { args: unknown; ctx: { userID: string } }) => unknown;
    }
  ).fn({ args, ctx: { userID } });
  return (await zql.run(query as Parameters<typeof zql.run>[0])) as Row[];
}

async function user(name: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({ id, name, email: `${id}@example.test` });
  return id;
}

void test("knowledge rows reach a work item, page or project only through their page's readers", async () => {
  const organizationId = crypto.randomUUID();
  const [owner, reader, outsider] = await Promise.all(
    ["Owner", "Reader", "Outsider"].map(user),
  );
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [
      [owner!, "owner"],
      [reader!, "member"],
    ].map(([userId, role]) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId: userId!,
      role: role!,
      createdAt: new Date(),
    })),
  );
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
  await run(owner!, {
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
  const workItemId = crypto.randomUUID();
  await run(owner!, {
    type: "createWorkItem",
    projectId,
    workItemId,
    typeId: story!.id,
    parentId: null,
    title: "Refunds",
  });
  const open = crypto.randomUUID();
  const restricted = crypto.randomUUID();
  await run(owner!, {
    type: "createSpace",
    spaceId: open,
    name: "Handbook",
    slug: "handbook",
  });
  await run(owner!, {
    type: "createSpace",
    spaceId: restricted,
    name: "Incidents",
    slug: "incidents",
    accessMode: "restricted",
  });
  const page = async (spaceId: string, title: string) =>
    (await run(owner!, {
      type: "createPage",
      spaceId,
      pageId: crypto.randomUUID(),
      title,
    }))!;
  const openPage = await page(open, "Onboarding");
  const secretPage = await page(restricted, "Breach");
  // Both pages mention the item in their published version, are attached
  // to it and are context pages of the project.
  for (const p of [openPage, secretPage]) {
    const pullRequestId = crypto.randomUUID();
    const proposed = (await run(owner!, {
      type: "proposePageChange",
      pageId: p.pageId!,
      branchId: crypto.randomUUID(),
      pullRequestId,
      title: "Updated",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "b1" },
            content: [
              { type: "workItemRef", attrs: { workItemId, key: "PAY-1" } },
            ],
          },
        ],
      },
      message: "Mention PAY-1",
    }))!;
    await run(owner!, {
      type: "mergePagePullRequest",
      pullRequestId,
      inspectedSourceHead: proposed.commitId!,
      inspectedTargetHead: p.commitId!,
    });
    await run(owner!, {
      type: "attachPage",
      workItemId,
      attachmentId: crypto.randomUUID(),
      pageId: p.pageId!,
      purpose: "background",
    });
    await run(owner!, {
      type: "linkContextPage",
      projectId,
      linkId: crypto.randomUUID(),
      pageId: p.pageId!,
    });
  }
  const byPage = (rows: Row[]) =>
    [...new Set(rows.map((r) => r.pageId))].sort();
  const itemArgs = { organizationId, workItemId };
  const ownerRows = await subscribe("workItemKnowledge", owner!, itemArgs);
  assert.deepEqual(
    byPage(ownerRows),
    [openPage.pageId!, secretPage.pageId!].sort(),
  );
  assert.deepEqual(ownerRows.map((r) => r.type).sort(), [
    "pageAttachment",
    "pageAttachment",
    "pageReference",
    "pageReference",
  ]);
  const readerRows = await subscribe("workItemKnowledge", reader!, itemArgs);
  assert.deepEqual(byPage(readerRows), [openPage.pageId!]);
  assert.ok(!JSON.stringify(readerRows).includes(secretPage.pageId!));
  assert.deepEqual(
    await subscribe("workItemKnowledge", outsider!, itemArgs),
    [],
  );
  const projectArgs = { organizationId, projectId };
  assert.deepEqual(
    byPage(await subscribe("projectContext", reader!, projectArgs)),
    [openPage.pageId!],
  );
  assert.equal(
    (await subscribe("projectContext", owner!, projectArgs)).length,
    2,
  );
  assert.deepEqual(
    await subscribe("pageWork", reader!, {
      organizationId,
      pageId: secretPage.pageId!,
    }),
    [],
  );
  assert.deepEqual(
    (
      await subscribe("pageWork", reader!, {
        organizationId,
        pageId: openPage.pageId!,
      })
    )
      .map((r) => r.type)
      .sort(),
    ["pageAttachment", "pageContextLink", "pageReference"],
  );
  // The organization and work item queries never carry knowledge rows.
  const itemQuery = JSON.stringify([
    ...(await subscribe("organization", reader!, { organizationId })),
    ...(await subscribe("workItem", reader!, itemArgs)),
  ]);
  for (const id of [openPage.pageId!, secretPage.pageId!])
    assert.ok(!itemQuery.includes(id), id);
  // Work surfaces: "N pages" counts, and page pull requests for the Inbox,
  // reach only readers of the page too.
  const orgArgs = { organizationId };
  assert.deepEqual(byPage(await subscribe("itemPageLinks", reader!, orgArgs)), [
    openPage.pageId!,
  ]);
  assert.deepEqual(
    (await subscribe("itemPageLinks", owner!, orgArgs))
      .map((r) => r.type)
      .sort(),
    ["pageAttachment", "pageAttachment", "pageReference", "pageReference"],
  );
  assert.deepEqual(
    byPage(await subscribe("myPagePullRequests", reader!, orgArgs)),
    [openPage.pageId!],
  );
  assert.deepEqual(
    await subscribe("myPagePullRequests", outsider!, orgArgs),
    [],
  );
  const reviewArgs = {
    organizationId,
    pageIds: [openPage.pageId!, secretPage.pageId!],
  } as unknown as Record<string, string>;
  assert.deepEqual(
    await subscribe("pagePullRequestReviews", reader!, reviewArgs),
    [],
  );
  // A grant brings the restricted page's rows in.
  await run(owner!, {
    type: "setSpaceGrant",
    spaceId: restricted,
    userId: reader!,
    level: "view",
  });
  assert.deepEqual(
    byPage(await subscribe("workItemKnowledge", reader!, itemArgs)),
    [openPage.pageId!, secretPage.pageId!].sort(),
  );
});
