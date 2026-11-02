import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { validateUIMessages, type ToolSet } from "ai";
import { z } from "zod";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { projectionDrift } from "@lictory/core/domain/projection-reader.test-helper";
import { refreshDirectories } from "@lictory/core/domain/projections";
import * as s from "@lictory/core/db/schema";
import { handleMcp } from "@lictory/core/mcp/server";
import { seedOrganization } from "@lictory/core/domain/organization";
import { commandSchema } from "@lictory/core/contracts/protocol";
import { authenticateAccessToken } from "@lictory/core/capabilities/access-tokens";
import {
  CapabilityError,
  noEffects,
  type CapabilityContext,
  type Principal,
} from "@lictory/core/capabilities/core";
import { invoke, listCapabilities } from "@lictory/core/capabilities/registry";
import { assistantTools } from "@lictory/core/intelligence/chat/assistant";
import type { ObjectStorage } from "@lictory/core/storage/s3";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_capability_test_${crypto.randomUUID().replaceAll("-", "")}`;
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

const context = (principal: Principal): CapabilityContext => ({
  db,
  principal,
  effects: noEffects,
});

async function organization(
  ownerId: string,
  memberIds: string[] = [],
  organizationId: string = crypto.randomUUID(),
) {
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [ownerId, ...memberIds].map((userId, index) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: index === 0 ? "owner" : "member",
      createdAt: new Date(),
    })),
  );
  await seedOrganization(db, organizationId);
  return organizationId;
}
async function user(name: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({ id, name, email: `${id}@example.test` });
  return id;
}

async function fixture() {
  const ownerId = await user("Owner");
  const memberId = await user("Member");
  const outsiderId = await user("Outsider");
  const organizationId = await organization(
    ownerId,
    [memberId],
    `Org${crypto.randomUUID().replaceAll("-", "")}Il0O`,
  );
  await organization(outsiderId);
  const web = context({ userId: ownerId, surface: "web" });
  const projectId = crypto.randomUUID();
  await invoke(web, "createProject", {
    organizationId,
    projectId,
    name: "Payments",
    key: "PAY",
  });
  // The creator administers the project and holds Product (every
  // capability); the member joins the project without a discipline.
  await invoke(web, "setProjectMember", {
    organizationId,
    projectId,
    userId: memberId,
    role: "member",
  });
  const workspace = (await invoke(web, "getWorkspace", {
    organizationId,
  })) as { types: { id: string; name: string }[] };
  const storyTypeId = workspace.types.find((t) => t.name === "Story")!.id;
  // An MCP token for the owner, created through the browser capability.
  const created = (await invoke(web, "createAccessToken", {
    name: "Claude",
    access: "write",
    expiresInDays: 30,
  })) as { secret: string; token: { id: string } };
  const token = (await authenticateAccessToken(db, created.secret))!;
  const mcp = context({
    userId: token.userId,
    surface: "mcp",
    tokenId: token.tokenId,
    access: token.access,
  });
  return {
    ownerId,
    memberId,
    outsiderId,
    organizationId,
    projectId,
    storyTypeId,
    web,
    mcp,
    secret: created.secret,
    tokenId: created.token.id,
  };
}

async function rejected(promise: Promise<unknown>, category: string) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof CapabilityError);
    assert.equal(error.category, category);
    return true;
  });
}

void test("every workspace command is exposed as a capability on every surface", () => {
  for (const option of commandSchema.options) {
    const name = option.shape.type.value;
    for (const surface of ["web", "mcp", "agent"] as const)
      assert.ok(
        listCapabilities(surface).some((c) => c.name === name),
        `${name} is missing on ${surface}`,
      );
  }
  // Credentials and the raw directory stay with the signed-in browser.
  for (const name of [
    "createAccessToken",
    "revokeAccessToken",
    "connectDelivery",
    "syncDirectory",
  ])
    assert.ok(!listCapabilities("mcp").some((c) => c.name === name));
});

void test("agents create work through the shared write path, idempotently", async () => {
  const f = await fixture();
  const mutationId = crypto.randomUUID();
  const input = {
    organizationId: f.organizationId,
    mutationId,
    projectId: f.projectId,
    typeId: f.storyTypeId,
    parentId: null,
    title: "Safe retries",
    description: "Avoid duplicate payments after a timeout.",
  };
  const first = (await invoke(f.mcp, "createWorkItem", input)) as {
    workItemId: string;
  };
  // A retry after a lost response replays instead of duplicating.
  const retry = (await invoke(f.mcp, "createWorkItem", input)) as {
    workItemId: string;
  };
  assert.equal(retry.workItemId, first.workItemId);
  const listed = (await invoke(f.mcp, "listWorkItems", {
    organizationId: f.organizationId,
  })) as { total: number; items: { key: string; id: string }[] };
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0]!.key, "PAY-1");

  // Read by key, then revise against the current revision.
  const item = (await invoke(f.mcp, "getWorkItem", {
    organizationId: f.organizationId,
    key: "PAY-1",
  })) as {
    item: { id: string };
    specification: { revisionId: string; number: number; content: string };
  };
  assert.equal(item.item.id, first.workItemId);
  assert.match(item.specification.content, /duplicate payments/);
  await invoke(f.mcp, "updateSpecification", {
    organizationId: f.organizationId,
    workItemId: first.workItemId,
    baseRevisionId: item.specification.revisionId,
    title: "Safe retries",
    content: "Retries reuse the original transaction ID.",
  });
  // A stale base is a conflict naming the current revision.
  await assert.rejects(
    invoke(f.mcp, "updateSpecification", {
      organizationId: f.organizationId,
      workItemId: first.workItemId,
      baseRevisionId: item.specification.revisionId,
      title: "Safe retries",
      content: "Lost update.",
    }),
    (error) => {
      assert.ok(error instanceof CapabilityError);
      assert.equal(error.category, "conflict");
      assert.ok(error.details.currentRevisionId);
      return true;
    },
  );
  const revised = (await invoke(f.mcp, "getWorkItem", {
    organizationId: f.organizationId,
    workItemId: first.workItemId,
  })) as {
    specification: { number: number; content: string };
    revisions: { content?: string }[];
  };
  assert.equal(revised.specification.number, item.specification.number + 1);
  // Historical revisions stay intact; their content is opt-in.
  assert.equal(revised.revisions.length, 2);
  assert.equal(revised.revisions[1]!.content, undefined);
  // Replaying create after a later edit must return the revision it created,
  // not whichever revision happens to be current at response time.
  assert.deepEqual(await invoke(f.mcp, "createWorkItem", input), first);
});

void test("agents hold exactly the person's permissions and tenant boundary", async () => {
  const f = await fixture();
  const create = (ctx: CapabilityContext) =>
    invoke(ctx, "createWorkItem", {
      organizationId: f.organizationId,
      projectId: f.projectId,
      typeId: f.storyTypeId,
      parentId: null,
      title: "Not allowed",
    });
  // A member without the edit-specifications capability is refused the same
  // way in the browser and through an agent.
  for (const surface of ["web", "mcp", "agent"] as const)
    await rejected(
      create(context({ userId: f.memberId, surface })),
      "forbidden",
    );
  // Project administrators only.
  await rejected(
    invoke(context({ userId: f.memberId, surface: "mcp" }), "createTeam", {
      organizationId: f.organizationId,
      projectId: f.projectId,
      name: "Platform",
    }),
    "forbidden",
  );
  await invoke(f.mcp, "createTeam", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    name: "Platform",
  });
  // Another organization's people cannot read or write it.
  const outsider = context({ userId: f.outsiderId, surface: "mcp" });
  await rejected(
    invoke(outsider, "listWorkItems", { organizationId: f.organizationId }),
    "forbidden",
  );
  await rejected(
    invoke(outsider, "getWorkItem", {
      organizationId: f.organizationId,
      key: "PAY-1",
    }),
    "forbidden",
  );
  await rejected(create(outsider), "forbidden");
  // Invalid input is a validation error, never a server error.
  await rejected(
    invoke(f.mcp, "createWorkItem", { organizationId: f.organizationId }),
    "validation",
  );
});

async function executeTool(tools: ToolSet, name: string, input: unknown) {
  const tool = tools[name];
  assert.ok(tool?.execute);
  const output: unknown = await tool.execute(input, {
    toolCallId: crypto.randomUUID(),
    messages: [],
    context: undefined,
  });
  return output;
}

void test("chat tools bind reads and writes to the conversation organization", async () => {
  const f = await fixture();
  const otherOrganizationId = await organization(f.ownerId);
  const agent = context({ userId: f.ownerId, surface: "agent" });
  const tools = assistantTools(agent, f.organizationId);
  assert.equal(tools.listOrganizations, undefined);
  for (const tool of Object.values(tools)) {
    assert.ok(tool.inputSchema instanceof z.ZodObject);
    assert.ok(!("organizationId" in tool.inputSchema.shape));
  }
  assert.equal(tools.mergePullRequest!.needsApproval, true);
  assert.equal(tools.deleteBranch!.needsApproval, true);
  const readSchema = tools.getWorkItem!.inputSchema as z.ZodObject;
  assert.equal(readSchema.safeParse({}).success, false);
  assert.equal(readSchema.safeParse({ key: "PAY-1" }).success, true);
  assert.equal(
    readSchema.safeParse({ key: "PAY-1", workItemId: crypto.randomUUID() })
      .success,
    false,
  );
  const schema = tools.createWorkItem!.inputSchema as z.ZodObject;
  const input = schema.parse({
    projectId: f.projectId,
    typeId: f.storyTypeId,
    parentId: null,
    title: "Created in the chat organization",
    mutationId: crypto.randomUUID(),
  });
  const first = await executeTool(tools, "createWorkItem", input);
  assert.equal((first as { ok: boolean }).ok, true);
  // Old transcripts or a client may still supply an organization. It never
  // overrides the chat, even when this person belongs to both organizations.
  const retry = await executeTool(tools, "createWorkItem", {
    ...input,
    organizationId: otherOrganizationId,
  });
  assert.deepEqual(retry, first);
  for (const organizationId of ["mistyped-organization", otherOrganizationId]) {
    const read = (await executeTool(tools, "listWorkItems", {
      organizationId,
    })) as { ok: boolean; result: { total: number } };
    assert.equal(read.ok, true);
    assert.equal(read.result.total, 1);
  }
  const other = (await invoke(f.web, "listWorkItems", {
    organizationId: otherOrganizationId,
  })) as { total: number };
  assert.equal(other.total, 0);
  // Existing conversation messages with the previous tool schema still load.
  await validateUIMessages({
    tools,
    messages: [
      {
        id: "old-message",
        role: "assistant",
        parts: [
          {
            type: "tool-createWorkItem",
            toolCallId: "old-call",
            state: "output-available",
            input: { ...input, organizationId: f.organizationId },
            output: first,
          },
        ],
      },
    ],
  });
  const audit = await db
    .select()
    .from(s.capabilityInvocation)
    .where(
      and(
        eq(s.capabilityInvocation.userId, f.ownerId),
        eq(s.capabilityInvocation.surface, "agent"),
      ),
    );
  assert.ok(audit.every((row) => row.organizationId === f.organizationId));
});

void test("chat binding preserves permissions and rechecks removed membership", async () => {
  const f = await fixture();
  const memberTools = assistantTools(
    context({ userId: f.memberId, surface: "agent" }),
    f.organizationId,
  );
  const denied = (await executeTool(memberTools, "createWorkItem", {
    projectId: f.projectId,
    typeId: f.storyTypeId,
    parentId: null,
    title: "Not permitted",
  })) as { ok: boolean; error: { category: string } };
  assert.equal(denied.ok, false);
  assert.equal(denied.error.category, "forbidden");
  const readerTools = assistantTools(
    context({ userId: f.ownerId, surface: "agent", access: "read" }),
    f.organizationId,
  );
  assert.equal(readerTools.createWorkItem, undefined);
  const tools = assistantTools(
    context({ userId: f.memberId, surface: "agent" }),
    f.organizationId,
  );
  await db
    .delete(s.member)
    .where(
      and(
        eq(s.member.organizationId, f.organizationId),
        eq(s.member.userId, f.memberId),
      ),
    );
  await refreshDirectories(db, [f.organizationId]);
  const removed = (await executeTool(tools, "getWorkspace", {})) as {
    ok: boolean;
    error: { category: string; message: string };
  };
  assert.equal(removed.ok, false);
  assert.equal(removed.error.category, "forbidden");
  assert.equal(
    removed.error.message,
    "You are not a member of this organization.",
  );
});

void test("MCP accepts slugs, audits canonical ids and gives safe recovery errors", async () => {
  const f = await fixture();
  const slug = `payments-${crypto.randomUUID()}`;
  await db
    .update(s.organization)
    .set({ slug })
    .where(eq(s.organization.id, f.organizationId));
  await refreshDirectories(db, [f.organizationId]);
  const call = async (
    name: string,
    args: Record<string, unknown>,
    ctx = f.mcp,
  ) => {
    const response = await handleMcp(ctx, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    });
    return (
      response as {
        result: {
          isError: boolean;
          structuredContent?: Record<string, unknown>;
          content: { text: string }[];
        };
      }
    ).result;
  };
  for (const organizationId of [f.organizationId, slug]) {
    const read = await call("getWorkspace", { organizationId });
    assert.equal(read.isError, false);
    assert.equal(
      (read.structuredContent!.organizations as { id: string }[])[0]!.id,
      f.organizationId,
    );
  }
  const args = {
    organizationId: slug,
    projectId: f.projectId,
    typeId: f.storyTypeId,
    parentId: null,
    title: "Created by slug",
    mutationId: crypto.randomUUID(),
  };
  const created = await call("createWorkItem", args);
  assert.equal(created.isError, false);
  const retried = await call("createWorkItem", {
    ...args,
    organizationId: f.organizationId,
  });
  assert.deepEqual(retried.structuredContent, created.structuredContent);
  const preferences = await call("setNotificationPreferences", {
    organizationId: slug,
    scope: "organization",
    scopeId: slug,
    rules: [{ kind: "review_requested", inApp: true, email: false }],
  });
  assert.equal(preferences.isError, false);
  for (const reference of ["unknown-organization", f.organizationId, slug]) {
    const denied = await call(
      "getWorkspace",
      { organizationId: reference },
      context({ userId: f.outsiderId, surface: "mcp" }),
    );
    assert.equal(denied.isError, true);
    const { error } = JSON.parse(denied.content[0]!.text) as {
      error: { category: string; message: string };
    };
    assert.equal(error.category, "forbidden");
    assert.equal(
      error.message,
      `Organization “${reference}” is unavailable or you are not a member. Call listOrganizations and use an id or slug from its results.`,
    );
  }
  const audit = await db
    .select()
    .from(s.capabilityInvocation)
    .where(
      and(
        eq(s.capabilityInvocation.userId, f.ownerId),
        eq(s.capabilityInvocation.surface, "mcp"),
      ),
    );
  assert.ok(audit.every((row) => row.organizationId === f.organizationId));
  // A slug that is also a different organization's id is refused rather
  // than silently sending a command to one of two accessible organizations.
  const ambiguous = await organization(f.ownerId);
  await db
    .update(s.organization)
    .set({ slug: `other-${ambiguous}` })
    .where(eq(s.organization.id, ambiguous));
  await db
    .update(s.organization)
    .set({ slug: ambiguous })
    .where(eq(s.organization.id, f.organizationId));
  await refreshDirectories(db, [f.organizationId, ambiguous]);
  const failure = await call("createWorkItem", {
    ...args,
    organizationId: ambiguous,
  });
  assert.equal(failure.isError, true);
  assert.match(failure.content[0]!.text, /matches more than one organization/);
});

void test("audit resolves failed MCP calls without rejected inserts or foreign attribution", async () => {
  const f = await fixture();
  const slug = `payments-${crypto.randomUUID()}`;
  await db
    .update(s.organization)
    .set({ slug })
    .where(eq(s.organization.id, f.organizationId));

  // Both organizations are accessible, but this id is also the other's slug.
  const ambiguousId = await organization(f.ownerId, [f.memberId]);
  const unambiguousSlug = `workspace-${ambiguousId}`;
  await db
    .update(s.organization)
    .set({ slug: unambiguousSlug })
    .where(eq(s.organization.id, ambiguousId));
  const otherId = await organization(f.ownerId, [f.memberId]);
  await db
    .update(s.organization)
    .set({ slug: ambiguousId })
    .where(eq(s.organization.id, otherId));
  await refreshDirectories(db, [f.organizationId, ambiguousId, otherId]);

  let inserts = 0;
  const auditedDb = drizzle(client, {
    schema: s,
    logger: {
      logQuery(query) {
        if (query.startsWith('insert into "capability_invocation"')) inserts++;
      },
    },
  });
  async function check(
    name: string,
    input: unknown,
    outcome: string,
    organizationId: string | null,
    principal: Principal = { userId: f.memberId, surface: "mcp" },
  ) {
    const clientName = `audit-regression-${crypto.randomUUID()}`;
    const ctx = {
      ...context({ ...principal, client: clientName }),
      db: auditedDb,
    };
    inserts = 0;
    if (outcome === "ok") await invoke(ctx, name, input);
    else await rejected(invoke(ctx, name, input), outcome);
    // The old FK-error fallback also left a row, but attempted two inserts.
    assert.equal(inserts, 1, `${name}: exactly one audit insert`);
    const rows = await db
      .select()
      .from(s.capabilityInvocation)
      .where(eq(s.capabilityInvocation.client, clientName));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.outcome, outcome);
    assert.equal(rows[0]!.organizationId, organizationId);
  }

  for (const reference of [slug, f.organizationId]) {
    await check(
      "createWorkItem",
      { organizationId: reference },
      "validation",
      f.organizationId,
    );
    await check(
      "createTeam",
      { organizationId: reference, projectId: f.projectId, name: "Platform" },
      "forbidden",
      f.organizationId,
    );
    await check(
      "getWorkspace",
      { organizationId: reference },
      "ok",
      f.organizationId,
    );
    // Token rejection happens before input validation and slug resolution.
    await check(
      "createTeam",
      { organizationId: reference },
      "forbidden",
      f.organizationId,
      { userId: f.memberId, surface: "mcp", access: "read" },
    );
    await check(
      "getWorkspace",
      { organizationId: reference },
      "forbidden",
      null,
      {
        userId: f.outsiderId,
        surface: "mcp",
      },
    );
  }
  for (const reference of ["unknown-organization", ambiguousId]) {
    await check(
      "getWorkspace",
      { organizationId: reference },
      reference === ambiguousId ? "validation" : "forbidden",
      null,
    );
    await check(
      "createWorkItem",
      { organizationId: reference },
      "validation",
      null,
    );
  }
  // Audit must keep the resolved id, not reinterpret it as an ambiguous id/slug
  // after a successful operation.
  await check(
    "getWorkspace",
    { organizationId: unambiguousSlug },
    "ok",
    ambiguousId,
  );
  await check(
    "getWorkspace",
    { scope: { organizationId: slug } },
    "validation",
    null,
  );
  await check("getWorkspace", { organizationId: 123 }, "validation", null);
  await check("listOrganizations", {}, "ok", null);
  for (const reference of [f.organizationId, slug, "unknown-organization"]) {
    await check(
      "createWorkItem",
      { organizationId: reference },
      "validation",
      reference === f.organizationId ? f.organizationId : null,
      { userId: f.memberId, surface: "agent" },
    );
  }
});

void test("access tokens: read-only, revocation, and audit", async () => {
  const f = await fixture();
  const readToken = (await invoke(f.web, "createAccessToken", {
    name: "Reader",
    access: "read",
    expiresInDays: null,
  })) as { secret: string };
  const reader = (await authenticateAccessToken(db, readToken.secret))!;
  assert.equal(reader.access, "read");
  const readCtx = context({
    userId: reader.userId,
    surface: "mcp",
    tokenId: reader.tokenId,
    access: "read",
  });
  await invoke(readCtx, "listOrganizations", {});
  await rejected(
    invoke(readCtx, "createLabel", {
      organizationId: f.organizationId,
      projectId: f.projectId,
      name: "risk",
      color: "red",
    }),
    "forbidden",
  );

  // Revoked and malformed tokens no longer authenticate.
  assert.ok(await authenticateAccessToken(db, f.secret));
  await invoke(f.web, "revokeAccessToken", { tokenId: f.tokenId });
  assert.equal(await authenticateAccessToken(db, f.secret), null);
  assert.equal(await authenticateAccessToken(db, "lct_not-a-token"), null);
  // Nobody else can revoke your token.
  await rejected(
    invoke(
      context({ userId: f.memberId, surface: "web" }),
      "revokeAccessToken",
      {
        tokenId: f.tokenId,
      },
    ),
    "not_found",
  );

  // Agent calls are audited with their outcome; inputs are not stored.
  const audit = await db
    .select()
    .from(s.capabilityInvocation)
    .where(
      and(
        eq(s.capabilityInvocation.userId, f.ownerId),
        eq(s.capabilityInvocation.tokenId, reader.tokenId),
      ),
    );
  assert.deepEqual(audit.map((a) => [a.capability, a.outcome]).sort(), [
    ["createLabel", "forbidden"],
    ["listOrganizations", "ok"],
  ]);
});

void test("MCP server lists typed tools and reports failures as tool results", async () => {
  const f = await fixture();
  const init = (await handleMcp(f.mcp, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {} },
  })) as { result: { protocolVersion: string } };
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(
    await handleMcp(f.mcp, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    null,
  );
  const listed = (await handleMcp(f.mcp, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  })) as {
    result: {
      tools: {
        name: string;
        inputSchema: {
          type: string;
          properties?: Record<string, unknown>;
          required?: string[];
        };
        annotations: { readOnlyHint: boolean };
      }[];
    };
  };
  const tools = listed.result.tools;
  assert.ok(tools.length > 80);
  for (const tool of tools) assert.equal(tool.inputSchema.type, "object");
  const create = tools.find((t) => t.name === "createWorkItem")!;
  // Generated identifiers are optional for agents.
  assert.ok(!create.inputSchema.required?.includes("workItemId"));
  assert.ok(create.inputSchema.required?.includes("organizationId"));
  assert.equal(
    tools.find((t) => t.name === "getWorkItem")!.annotations.readOnlyHint,
    true,
  );

  const call = (await handleMcp(f.mcp, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "getWorkItem",
      arguments: { organizationId: f.organizationId, key: "PAY-999" },
    },
  })) as {
    result: { isError: boolean; content: { text: string }[] };
  };
  assert.equal(call.result.isError, true);
  const failure = JSON.parse(call.result.content[0]!.text) as {
    error: { category: string };
  };
  assert.equal(failure.error.category, "not_found");
  const unknown = (await handleMcp(f.mcp, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "createAccessToken", arguments: {} },
  })) as { error: { code: number } };
  assert.equal(unknown.error.code, -32602);

  // Read-only tokens only discover queries.
  const readOnly = (await handleMcp(
    { ...f.mcp, principal: { ...f.mcp.principal, access: "read" } },
    { jsonrpc: "2.0", id: 5, method: "tools/list" },
  )) as { result: { tools: { annotations: { readOnlyHint: boolean } }[] } };
  assert.ok(readOnly.result.tools.every((t) => t.annotations.readOnlyHint));
});

void test("insights are computed from the person's own workspace and stay inside it", async () => {
  const f = await fixture();
  for (const title of ["Safe retries", "Refund webhooks"])
    await invoke(f.mcp, "createWorkItem", {
      organizationId: f.organizationId,
      projectId: f.projectId,
      typeId: f.storyTypeId,
      parentId: null,
      title,
    });
  const agent = context({ userId: f.ownerId, surface: "agent" });
  const insights = (await invoke(agent, "getInsights", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    topic: "refinement",
  })) as {
    headline: string;
    scope: { projectName: string };
    cards: { id: string; segments?: { key: string; value: number }[] }[];
  };
  assert.equal(insights.scope.projectName, "Payments");
  const states = insights.cards.find((c) => c.id === "refinement-state")!;
  assert.equal(
    states.segments!.reduce((n, s) => n + s.value, 0),
    2,
    "both open Stories carry a specification",
  );
  assert.match(insights.headline, /of 2 open specifications/);
  // Read-only tokens may ask; other organizations may not.
  await invoke(
    { ...f.mcp, principal: { ...f.mcp.principal, access: "read" } },
    "getInsights",
    { organizationId: f.organizationId, topic: "people" },
  );
  await rejected(
    invoke(context({ userId: f.outsiderId, surface: "agent" }), "getInsights", {
      organizationId: f.organizationId,
      topic: "delivery",
    }),
    "forbidden",
  );
  await rejected(
    invoke(agent, "getInsights", {
      organizationId: f.organizationId,
      topic: "people",
      teamId: crypto.randomUUID(),
    }),
    "not_found",
  );
});

void test("MCP work item keys survive a second project and writes name what they created", async () => {
  const f = await fixture();
  const created = (await invoke(f.mcp, "createWorkItem", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    typeId: f.storyTypeId,
    parentId: null,
    title: "First key",
    description: "The original project.",
  })) as { workItemId: string; key: string; revisionId: string };
  assert.match(created.key, /^PAY-1$/);
  assert.ok(created.revisionId);
  const billingId = crypto.randomUUID();
  await invoke(f.mcp, "createProject", {
    organizationId: f.organizationId,
    projectId: billingId,
    name: "Billing",
    key: "BIL",
  });
  const billingType = (
    (await invoke(f.web, "getWorkspace", {
      organizationId: f.organizationId,
    })) as { types: { id: string; name: string }[] }
  ).types.find((type) => type.name === "Story")!.id;
  const billing = (await invoke(f.mcp, "createWorkItem", {
    organizationId: f.organizationId,
    projectId: billingId,
    typeId: billingType,
    parentId: null,
    title: "Billing key",
  })) as { key: string };
  assert.equal(billing.key, "BIL-1");
  const read = async (key: string) =>
    (await invoke(f.mcp, "getWorkItem", {
      organizationId: f.organizationId,
      key,
    })) as { item: { id: string; key: string }; aiRuns: { model?: string }[] };
  assert.equal((await read(created.key)).item.id, created.workItemId);
  assert.equal((await read("bil-1")).item.key, "BIL-1");
  await invoke(f.mcp, "archiveProject", {
    organizationId: f.organizationId,
    projectId: billingId,
    archived: true,
  });
  assert.equal((await read("PAY-1")).item.id, created.workItemId);
  assert.equal((await read("BIL-1")).item.key, "BIL-1");
  await rejected(
    invoke(f.mcp, "getWorkItem", {
      organizationId: f.organizationId,
      key: "NOPE-1",
    }),
    "not_found",
  );
  await assert.rejects(
    invoke(f.mcp, "createWorkItem", {
      organizationId: f.organizationId,
      projectId: f.projectId,
      typeId: f.storyTypeId,
      parentId: null,
      title: "Wrong fields",
      content: "This is specification text.",
      estimate: 4,
    }),
    (error) => {
      assert.ok(error instanceof CapabilityError);
      assert.equal(error.category, "validation");
      assert.match(error.message, /Unknown field\(s\):/);
      assert.match(error.message, /content/);
      assert.match(error.message, /estimate/);
      assert.match(error.message, /belongs in `description`/);
      return true;
    },
  );
});

void test("workspace reads report application roles, one project, and catalog lists", async () => {
  const f = await fixture();
  const organizations = (await invoke(f.web, "listOrganizations", {})) as {
    organizations: { id: string; role: string }[];
  };
  assert.equal(
    organizations.organizations.find((o) => o.id === f.organizationId)?.role,
    "admin",
  );
  const otherId = crypto.randomUUID();
  await invoke(f.web, "createProject", {
    organizationId: f.organizationId,
    projectId: otherId,
    name: "Billing",
    key: "BIL",
  });
  const scoped = (await invoke(f.web, "getWorkspace", {
    organizationId: f.organizationId,
    projectId: f.projectId,
  })) as {
    projects: { id: string }[];
    organizations: { role: string }[];
    statuses: { projectId: string }[];
  };
  assert.deepEqual(
    scoped.projects.map((project) => project.id),
    [f.projectId],
  );
  assert.ok(
    scoped.statuses.every((status) => status.projectId === f.projectId),
  );
  assert.equal(scoped.organizations[0]!.role, "admin");
  await rejected(
    invoke(f.web, "getWorkspace", {
      organizationId: f.organizationId,
      projectId: crypto.randomUUID(),
    }),
    "not_found",
  );
  const labelId = crypto.randomUUID();
  await invoke(f.mcp, "createLabel", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    labelId,
    name: "risk",
    color: "red",
  });
  const labels = (await invoke(f.mcp, "listLabels", {
    organizationId: f.organizationId,
    projectId: f.projectId,
  })) as { labels: { id: string; name: string }[] };
  assert.deepEqual(
    labels.labels.map((label) => label.name),
    ["risk"],
  );
  await invoke(f.mcp, "updateLabel", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    labelId,
    archived: true,
  });
  const hidden = (await invoke(f.mcp, "listLabels", {
    organizationId: f.organizationId,
    projectId: f.projectId,
  })) as { labels: unknown[] };
  assert.equal(hidden.labels.length, 0);
  const milestones = (await invoke(f.mcp, "listMilestones", {
    organizationId: f.organizationId,
    projectId: f.projectId,
  })) as { milestones: unknown[] };
  assert.deepEqual(milestones.milestones, []);
});

void test("watch reasons, logo removal, context retries, and empty notification writes report what changed", async () => {
  const f = await fixture();
  const created = (await invoke(f.mcp, "createWorkItem", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    typeId: f.storyTypeId,
    parentId: null,
    title: "Watched",
  })) as { workItemId: string };
  const watching = (await invoke(f.mcp, "getWatching", {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
  })) as { watching: boolean | null; reasons: string[] };
  assert.equal(watching.watching, null);
  assert.deepEqual(watching.reasons, ["author"]);
  await rejected(
    invoke(f.mcp, "getWatching", {
      organizationId: f.organizationId,
      workItemId: crypto.randomUUID(),
    }),
    "not_found",
  );
  const removed = (await invoke(f.web, "removeOrganizationLogo", {
    organizationId: f.organizationId,
    kind: "mark",
  })) as { removed: boolean };
  assert.equal(removed.removed, false);
  const key = crypto.randomUUID();
  const first = (await invoke(f.web, "createIntelligenceContext", {
    organizationId: f.organizationId,
    target: { scope: "organization" },
    title: "Voice",
    content: "Be concise.",
    idempotencyKey: key,
  })) as { id: string };
  const retry = (await invoke(f.web, "createIntelligenceContext", {
    organizationId: f.organizationId,
    target: { scope: "organization" },
    title: "Voice",
    content: "Be verbose.",
    idempotencyKey: key,
  })) as { id: string };
  assert.equal(retry.id, first.id);
  const entries = await db
    .select()
    .from(s.intelligenceContextEntry)
    .where(eq(s.intelligenceContextEntry.organizationId, f.organizationId));
  assert.equal(entries.length, 1);
  const read = (await invoke(f.web, "markNotificationsRead", {
    ids: [crypto.randomUUID()],
    read: true,
  })) as { ok: boolean; affected: number };
  assert.deepEqual(read, { ok: true, affected: 0 });
  await rejected(
    invoke(f.mcp, "unlinkExternalItem", {
      organizationId: f.organizationId,
      workItemId: created.workItemId,
      connectionId: crypto.randomUUID(),
    }),
    "not_found",
  );
});

void test("missing intelligence context uses not_found across the capability boundary", async () => {
  const f = await fixture();
  await rejected(
    invoke(f.mcp, "getIntelligenceContextHistory", {
      organizationId: f.organizationId,
      entryId: crypto.randomUUID(),
    }),
    "not_found",
  );
});

void test("attachment downloads honor inline MIME types and reject removed files", async () => {
  const f = await fixture();
  const created = (await invoke(f.mcp, "createWorkItem", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    typeId: f.storyTypeId,
    parentId: null,
    title: "With attachment",
  })) as { workItemId: string };
  const downloads: boolean[] = [];
  const withStorage: CapabilityContext = {
    ...f.mcp,
    storage: () => ({
      presignUpload: () =>
        Promise.resolve("https://storage.example.test/upload"),
      presignDownload: (_key, _filename, mimeType, inline) => {
        assert.equal(mimeType, "application/pdf");
        downloads.push(inline);
        return Promise.resolve("https://storage.example.test/download");
      },
      stat: () => Promise.resolve({ size: 3, contentType: "application/pdf" }),
      copy: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    }),
  };
  const input = {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
    filename: "spec.pdf",
    mimeType: "application/pdf",
    size: 3,
  };
  const upload = (await invoke(
    withStorage,
    "startAttachmentUpload",
    input,
  )) as { id: string };
  await invoke(withStorage, "finishAttachmentUpload", {
    organizationId: f.organizationId,
    id: upload.id,
  });
  await invoke(withStorage, "getAttachmentDownloadUrl", {
    fileId: upload.id,
    inline: true,
  });
  await invoke(withStorage, "getAttachmentDownloadUrl", { fileId: upload.id });
  assert.deepEqual(downloads, [true, false]);
  await invoke(withStorage, "removeAttachment", {
    organizationId: f.organizationId,
    id: upload.id,
  });
  await rejected(
    invoke(withStorage, "getAttachmentDownloadUrl", {
      fileId: upload.id,
      inline: true,
    }),
    "not_found",
  );
  assert.equal(downloads.length, 2);
});

// A bucket where a signed download link names an object key, like S3/R2: the
// link works for as long as an object exists at that key.
function memoryBucket() {
  const objects = new Map<string, { size: number; contentType: string }>();
  const failures = { copy: 0, delete: 0 };
  const storage: ObjectStorage = {
    presignUpload: (key, contentType, size) => {
      objects.set(key, { size, contentType });
      return Promise.resolve(`https://storage.example.test/put/${key}`);
    },
    presignDownload: (key) =>
      Promise.resolve(`https://storage.example.test/get/${key}`),
    stat: (key) => {
      const object = objects.get(key);
      return object
        ? Promise.resolve(object)
        : Promise.reject(new Error("NotFound"));
    },
    copy: (source, destination) => {
      const object = objects.get(source);
      if (failures.copy-- > 0 || !object)
        return Promise.reject(new Error("copy failed"));
      objects.set(destination, object);
      return Promise.resolve();
    },
    delete: (key) => {
      if (failures.delete-- > 0)
        return Promise.reject(new Error("delete failed"));
      objects.delete(key);
      return Promise.resolve();
    },
  };
  const fetchLink = (url: string) =>
    objects.has(url.replace("https://storage.example.test/get/", ""))
      ? 200
      : 404;
  return { storage, objects, failures, fetchLink };
}

async function uploadedAttachment(f: Awaited<ReturnType<typeof fixture>>) {
  const created = (await invoke(f.mcp, "createWorkItem", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    typeId: f.storyTypeId,
    parentId: null,
    title: "With attachment",
  })) as { workItemId: string };
  const bucket = memoryBucket();
  const ctx: CapabilityContext = { ...f.mcp, storage: () => bucket.storage };
  const upload = (await invoke(ctx, "startAttachmentUpload", {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
    filename: "spec.pdf",
    mimeType: "application/pdf",
    size: 3,
  })) as { id: string };
  await invoke(ctx, "finishAttachmentUpload", {
    organizationId: f.organizationId,
    id: upload.id,
  });
  return { ctx, bucket, fileId: upload.id };
}

void test("removing an attachment revokes download links issued before the removal", async () => {
  const f = await fixture();
  const { ctx, bucket, fileId } = await uploadedAttachment(f);
  const { url } = (await invoke(ctx, "getAttachmentDownloadUrl", {
    fileId,
    inline: true,
  })) as { url: string };
  assert.equal(bucket.fetchLink(url), 200);

  assert.deepEqual(
    await invoke(ctx, "removeAttachment", {
      organizationId: f.organizationId,
      id: fileId,
    }),
    { removed: true },
  );
  assert.equal(bucket.fetchLink(url), 404);
  await rejected(
    invoke(ctx, "getAttachmentDownloadUrl", { fileId }),
    "not_found",
  );
  // The bytes are retained under a key no issued link names.
  const retained = `organizations/${f.organizationId}/removed-files/${fileId}`;
  assert.deepEqual([...bucket.objects.keys()], [retained]);
  const [row] = await db
    .select({ objectKey: s.fileObject.objectKey })
    .from(s.fileObject)
    .where(eq(s.fileObject.id, fileId));
  assert.equal(row?.objectKey, retained);

  assert.deepEqual(
    await invoke(ctx, "removeAttachment", {
      organizationId: f.organizationId,
      id: fileId,
    }),
    { removed: false },
  );
  assert.deepEqual([...bucket.objects.keys()], [retained]);
});

void test("an interrupted attachment removal reports it and finishes on retry", async () => {
  const f = await fixture();
  const { ctx, bucket, fileId } = await uploadedAttachment(f);
  const { url } = (await invoke(ctx, "getAttachmentDownloadUrl", {
    fileId,
  })) as { url: string };
  // The copy lands but deleting the original fails.
  bucket.failures.delete = 1;
  await rejected(
    invoke(ctx, "removeAttachment", {
      organizationId: f.organizationId,
      id: fileId,
    }),
    "external",
  );
  // The removal itself is recorded: no new links are issued.
  await rejected(
    invoke(ctx, "getAttachmentDownloadUrl", { fileId }),
    "not_found",
  );
  assert.equal(bucket.fetchLink(url), 200);

  assert.deepEqual(
    await invoke(ctx, "removeAttachment", {
      organizationId: f.organizationId,
      id: fileId,
    }),
    { removed: false },
  );
  assert.equal(bucket.fetchLink(url), 404);
  assert.deepEqual(
    [...bucket.objects.keys()],
    [`organizations/${f.organizationId}/removed-files/${fileId}`],
  );
});

void test("recorded decisions retain their source revision, replay once, and are tenant scoped", async () => {
  const f = await fixture();
  const created = (await invoke(f.mcp, "createWorkItem", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    typeId: f.storyTypeId,
    parentId: null,
    title: "Retries",
    description: "Retries reuse a stable key.",
  })) as { workItemId: string; revisionId: string };
  const thread = (await invoke(f.web, "createThread", {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
    baseRevisionId: created.revisionId,
    section: "",
    body: "Which key?",
    blocking: false,
  })) as { threadId: string };
  const decision = {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
    baseRevisionId: created.revisionId,
    title: "Reuse the transaction key",
    body: "Retry attempts use the original transaction key.",
    sourceThreadId: thread.threadId,
    mutationId: crypto.randomUUID(),
  };
  await rejected(invoke(f.web, "recordDecision", decision), "conflict");
  await invoke(f.web, "setThreadState", {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
    threadId: thread.threadId,
    resolved: true,
    blocking: false,
  });
  const revised = (await invoke(f.web, "updateSpecification", {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
    baseRevisionId: created.revisionId,
    title: "Retries",
    content: "Retries reuse a stable key for 24 hours.",
  })) as { revisionId: string };
  const principal = context({
    userId: f.ownerId,
    surface: "mcp",
    client: "Refinement agent",
  });
  const input = { ...decision, baseRevisionId: revised.revisionId };
  const first = (await invoke(principal, "recordDecision", input)) as {
    decisionId: string;
  };
  assert.deepEqual(await invoke(principal, "recordDecision", input), first);
  const item = (await invoke(f.web, "getWorkItem", {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
  })) as {
    decisions: { id: string; revisionId: string }[];
    activity: { action: string; detail: Record<string, unknown> }[];
  };
  assert.equal(item.decisions.length, 1);
  assert.equal(item.decisions[0]!.revisionId, created.revisionId);
  const activity = item.activity.find((a) => a.action === "decision_recorded")!;
  assert.equal(activity.detail.performedVia, "mcp");
  assert.equal(activity.detail.agentClient, "Refinement agent");
  const search = () =>
    invoke(f.web, "searchProductKnowledge", {
      organizationId: f.organizationId,
      query: "transaction key",
    }) as Promise<{
      results: { id: string; kind: string; revisionNumber: number }[];
    }>;
  assert.deepEqual(
    (await search()).results.map((r) => [r.id, r.kind, r.revisionNumber]),
    [[first.decisionId, "decision", 1]],
  );
  await invoke(f.web, "setDecisionArchived", {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
    decisionId: first.decisionId,
    archived: true,
  });
  assert.equal((await search()).results.length, 0);
  await invoke(f.web, "setDecisionArchived", {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
    decisionId: first.decisionId,
    archived: false,
  });
  assert.equal((await search()).results.length, 1);
  await rejected(
    invoke(
      context({ userId: f.memberId, surface: "agent" }),
      "recordDecision",
      { ...input, mutationId: crypto.randomUUID(), sourceThreadId: undefined },
    ),
    "forbidden",
  );
  await rejected(
    invoke(
      context({ userId: f.outsiderId, surface: "mcp" }),
      "searchProductKnowledge",
      { organizationId: f.organizationId },
    ),
    "forbidden",
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("product knowledge preserves delivered scope after a newer draft", async () => {
  const f = await fixture();
  const workspace = (await invoke(f.web, "getWorkspace", {
    organizationId: f.organizationId,
  })) as {
    types: { id: string; name: string }[];
    statuses: { id: string; projectId: string; category: string }[];
  };
  const created = (await invoke(f.web, "createWorkItem", {
    organizationId: f.organizationId,
    projectId: f.projectId,
    typeId: workspace.types.find((t) => t.name === "Task")!.id,
    parentId: null,
    title: "Delivery evidence",
    description: "The delivered retry behavior.",
  })) as { workItemId: string; revisionId: string };
  await invoke(f.web, "acceptDeliveryScope", {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
    baseRevisionId: created.revisionId,
  });
  const committed = (await invoke(f.web, "listWorkItems", {
    organizationId: f.organizationId,
    lifecycle: "committed",
  })) as { items: { id: string; lifecycle: string }[] };
  assert.ok(
    committed.items.some(
      (i) => i.id === created.workItemId && i.lifecycle === "committed",
    ),
  );
  await invoke(f.web, "updateWorkItem", {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
    statusId: workspace.statuses.find(
      (st) => st.projectId === f.projectId && st.category === "done",
    )!.id,
  });
  await invoke(f.web, "updateSpecification", {
    organizationId: f.organizationId,
    workItemId: created.workItemId,
    baseRevisionId: created.revisionId,
    title: "Delivery evidence",
    content: "A later proposal for different retry behavior.",
  });
  const found = (await invoke(f.web, "searchProductKnowledge", {
    organizationId: f.organizationId,
    query: "retry behavior",
  })) as {
    results: { kind: string; revisionNumber: number; excerpt: string }[];
  };
  assert.deepEqual(
    found.results.map((r) => [r.kind, r.revisionNumber, r.excerpt]),
    [["delivered", 1, "The delivered retry behavior."]],
  );
  const completed = (await invoke(f.web, "listWorkItems", {
    organizationId: f.organizationId,
    lifecycle: "completed",
  })) as { items: { id: string }[] };
  assert.ok(completed.items.some((i) => i.id === created.workItemId));
});

void test("projections equal a rebuild from the domain", async () => {
  const drift: string[] = [];
  for (const { id } of await db
    .select({ id: s.organization.id })
    .from(s.organization))
    drift.push(...(await projectionDrift(db, id)));
  assert.deepEqual(drift, []);
});
