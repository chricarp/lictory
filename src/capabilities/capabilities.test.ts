import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "../db/schema";
import { handleMcp } from "../mcp/server";
import { seedDefaultRoles } from "../sync/server/roles";
import { commandSchema } from "../sync/shared/protocol";
import { authenticateAccessToken } from "./access-tokens";
import {
  CapabilityError,
  noEffects,
  type CapabilityContext,
  type Principal,
} from "./core";
import { invoke, listCapabilities } from "./registry";

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

async function organization(ownerId: string, memberIds: string[] = []) {
  const organizationId = crypto.randomUUID();
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
  // The owner joins Product (every capability); members hold no role.
  await seedDefaultRoles(db, organizationId, ownerId);
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
  const organizationId = await organization(ownerId, [memberId]);
  await organization(outsiderId);
  const web = context({ userId: ownerId, surface: "web" });
  const projectId = crypto.randomUUID();
  await invoke(web, "createProject", {
    organizationId,
    projectId,
    name: "Payments",
    key: "PAY",
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
  // Credentials and raw sync stay with the signed-in browser.
  for (const name of [
    "createAccessToken",
    "revokeAccessToken",
    "connectDelivery",
    "applyMutation",
    "syncRead",
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
  // Administrators only.
  await rejected(
    invoke(context({ userId: f.memberId, surface: "mcp" }), "createTeam", {
      organizationId: f.organizationId,
      name: "Platform",
    }),
    "forbidden",
  );
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
    "unavailable",
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
  assert.equal(failure.error.category, "unavailable");
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
