import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { noEffects } from "@lictory/core/capabilities/core";
import { invoke } from "@lictory/core/capabilities/registry";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation } from "@lictory/core/domain/service";
import { blockContexts } from "@lictory/core/spaces/link-details";

// describePageLinks (docs/internals/knowledge-links.md, Work surfaces):
// where a page mentions an item and which version a pinned commit is, for
// pages the reader can read, and nothing at all about the others.

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_link_details_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 4, onnotice: () => undefined });
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

type Node = Record<string, unknown>;
const text = (value: string): Node => ({ type: "text", text: value });
const block = (type: string, id: string, ...content: Node[]): Node => ({
  type,
  attrs: type === "heading" ? { id, level: 2 } : { id },
  content,
});

void test("block contexts name the section above a block and shorten its text", () => {
  const doc = {
    type: "doc",
    content: [
      block("paragraph", "intro", text("Before any heading")),
      block("heading", "h-retries", text("Retries")),
      block(
        "paragraph",
        "p-1",
        text("Retry "),
        { type: "workItemRef", attrs: { workItemId: "x", key: "PAY-2" } },
        text(" three times."),
      ),
      block("paragraph", "p-long", text("word ".repeat(80))),
    ],
  };
  assert.deepEqual(
    blockContexts(doc, ["p-1", "intro", "h-retries", "missing"]),
    [
      {
        blockId: "p-1",
        heading: "Retries",
        excerpt: "Retry PAY-2 three times.",
      },
      { blockId: "intro", heading: null, excerpt: "Before any heading" },
      { blockId: "h-retries", heading: null, excerpt: "Retries" },
    ],
  );
  const long = blockContexts(doc, ["p-long"])[0]!;
  assert.ok(long.excerpt.endsWith("…"));
  assert.ok(long.excerpt.length <= 161);
});

void test("only readers of a page learn where it mentions work and which version a pin is", async () => {
  const organizationId = crypto.randomUUID();
  const ids = Object.fromEntries(
    ["owner", "reader", "outsider"].map((n) => [n, crypto.randomUUID()]),
  ) as Record<"owner" | "reader" | "outsider", string>;
  for (const [name, id] of Object.entries(ids))
    await db
      .insert(s.user)
      .values({ id, name, email: `${id}@example.test`, emailVerified: true });
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: organizationId,
    createdAt: new Date(),
  });
  for (const [name, id] of Object.entries(ids))
    await db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId: id,
      role: name === "owner" ? "owner" : "member",
      createdAt: new Date(),
    });
  await seedOrganization(db, organizationId);
  const run = async (command: Command) =>
    (
      await executeMutation(
        db,
        { userId: ids.owner },
        {
          protocol: PROTOCOL,
          id: crypto.randomUUID(),
          organizationId,
          command,
        },
      )
    ).summary as Record<string, string>;
  const spaceId = crypto.randomUUID();
  await run({
    type: "createSpace",
    spaceId,
    name: "Security",
    slug: `security-${spaceId.slice(0, 8)}`,
    accessMode: "restricted",
  });
  await run({
    type: "setSpaceGrant",
    spaceId,
    userId: ids.reader,
    level: "view",
  });
  const pageId = crypto.randomUUID();
  const first = await run({
    type: "createPage",
    spaceId,
    pageId,
    title: "Incident runbook",
  });
  const mainHead = async () =>
    (
      await db
        .select({ head: s.pageBranch.headCommitId })
        .from(s.pageBranch)
        .where(
          and(eq(s.pageBranch.pageId, pageId), eq(s.pageBranch.isMain, true)),
        )
    )[0]!.head;
  const pullRequestId = crypto.randomUUID();
  const proposed = await run({
    type: "proposePageChange",
    pageId,
    branchId: crypto.randomUUID(),
    pullRequestId,
    title: "Incident runbook",
    content: {
      type: "doc",
      content: [
        block("heading", "h-escalate", text("Escalation")),
        block("paragraph", "p-page", text("Page the on-call engineer.")),
      ],
    } as unknown as Record<string, never>,
    message: "Escalation",
  });
  await run({
    type: "mergePagePullRequest",
    pullRequestId,
    inspectedSourceHead: proposed.commitId!,
    inspectedTargetHead: await mainHead(),
  });
  const published = await mainHead();
  const describe = (userId: string, otherPageCommit?: string) =>
    invoke(
      { db, principal: { userId, surface: "web" }, effects: noEffects },
      "describePageLinks",
      {
        organizationId,
        pages: [
          {
            pageId,
            blocks: { commitId: published, blockIds: ["p-page"] },
            versions: [
              first.commitId!,
              ...(otherPageCommit ? [otherPageCommit] : []),
            ],
          },
        ],
      },
    ) as Promise<{
      pages: {
        pageId: string;
        title: string;
        publishedVersion: number;
        versions: Record<string, number>;
        blocks: { blockId: string; heading: string | null; excerpt: string }[];
      }[];
    }>;

  const seen = await describe(ids.reader);
  assert.equal(seen.pages.length, 1);
  assert.equal(seen.pages[0]!.title, "Incident runbook");
  assert.equal(seen.pages[0]!.publishedVersion, 2);
  assert.deepEqual(seen.pages[0]!.versions, { [first.commitId!]: 1 });
  assert.deepEqual(seen.pages[0]!.blocks, [
    {
      blockId: "p-page",
      heading: "Escalation",
      excerpt: "Page the on-call engineer.",
    },
  ]);
  // Someone outside the restricted space gets no entry: not the title, not
  // the block, not that the page exists.
  assert.deepEqual(await describe(ids.outsider), { pages: [] });

  // A commit of another page answers nothing about it.
  const otherSpace = crypto.randomUUID();
  await run({
    type: "createSpace",
    spaceId: otherSpace,
    name: "Open",
    slug: `open-${otherSpace.slice(0, 8)}`,
  });
  const other = await run({
    type: "createPage",
    spaceId: otherSpace,
    pageId: crypto.randomUUID(),
    title: "Other",
  });
  const mixed = await describe(ids.reader, other.commitId);
  assert.deepEqual(mixed.pages[0]!.versions, { [first.commitId!]: 1 });
});
