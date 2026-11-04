import { test, expect, type APIRequestContext } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { createWorkspace } from "../helpers/onboarding-helpers";
import { inApp } from "../helpers/app-urls";
import { clientAddress } from "../helpers/client-address";

const email = "agents@example.test";
const password = "Local-test-password-123";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});
test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const id = crypto.randomUUID();
  const inserted = await db
    .insert(s.user)
    .values({
      id,
      name: "Avery Agent",
      email,
      emailVerified: true,
      handle: "avery_agent",
    })
    .onConflictDoNothing()
    .returning({ id: s.user.id });
  if (inserted.length)
    await db.insert(s.account).values({
      id: crypto.randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: await hashPassword(password),
    });
  await client.end();
});

function mcp(request: APIRequestContext, token: string) {
  let id = 0;
  return async (method: string, params?: Record<string, unknown>) => {
    const response = await request.post("/api/mcp", {
      headers: { Authorization: `Bearer ${token}` },
      data: { jsonrpc: "2.0", id: ++id, method, params },
    });
    return {
      status: response.status(),
      body: (await response.json().catch(() => null)) as {
        result?: {
          tools?: { name: string }[];
          isError?: boolean;
          content?: { text: string }[];
          structuredContent?: Record<string, unknown>;
        };
      } | null,
    };
  };
}

test("a person connects an MCP agent that works with their permissions", async ({
  page,
  playwright,
  baseURL,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(inApp);
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "Agent Co",
    project: "Agent project",
    key: "AGT",
  });
  const workspaceUrl = page.url();

  // Create a token in account settings; the secret is shown once.
  await page.goto("/account#agents");
  const section = page.locator("#agents");
  await section.getByRole("button", { name: "New token" }).click();
  await section
    .getByLabel("Agent name", { exact: true })
    .fill("Playwright agent");
  await section.getByRole("button", { name: "Create token" }).click();
  const secret = (
    await page.getByTestId("access-token-secret").textContent()
  )?.trim();
  expect(secret).toMatch(/^lct_/);
  await expect(section.getByText("Playwright agent")).toBeVisible();

  // The agent is a separate client without the browser's cookies.
  const request = await playwright.request.newContext({ baseURL });
  const call = mcp(request, secret!);
  const init = await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "playwright", version: "1" },
  });
  expect(init.status).toBe(200);
  const tools = (await call("tools/list")).body!.result!.tools!.map(
    (t) => t.name,
  );
  expect(tools).toContain("createWorkItem");
  expect(tools).not.toContain("createAccessToken");

  const tool = async (name: string, args: Record<string, unknown>) => {
    const { body } = await call("tools/call", { name, arguments: args });
    expect(body?.result?.isError, JSON.stringify(body)).toBe(false);
    return body!.result!.structuredContent!;
  };
  const { organizations } = (await tool("listOrganizations", {})) as {
    organizations: { id: string; name: string; slug: string }[];
  };
  const organization = organizations.find((o) => o.name === "Agent Co")!;
  const workspace = (await tool("getWorkspace", {
    organizationId: organization.slug,
  })) as {
    projects: { id: string; key: string }[];
    types: { id: string; name: string }[];
  };
  const created = (await tool("createWorkItem", {
    organizationId: organization.slug,
    projectId: workspace.projects.find((p) => p.key === "AGT")!.id,
    typeId: workspace.types.find((t) => t.name === "Epic")!.id,
    parentId: null,
    title: "Drafted by an agent",
    description: "Created through MCP.",
  })) as { workItemId: string };
  expect(created.workItemId).toBeTruthy();

  const invalid = await call("tools/call", {
    name: "getWorkspace",
    arguments: { organizationId: "mistyped-workspace" },
  });
  expect(invalid.body!.result!.isError).toBe(true);
  expect(invalid.body!.result!.content![0]!.text).toContain(
    "Call listOrganizations",
  );
  // The same client can recover with the exact id returned by discovery.
  await tool("getWorkItem", {
    organizationId: organization.id,
    workItemId: created.workItemId,
  });

  // The person sees the agent's work in the browser like any other change.
  await page.goto(workspaceUrl);
  await expect(page.getByText("Drafted by an agent")).toBeVisible();

  // Revoking disconnects the agent immediately.
  await page.goto("/account#agents");
  await page
    .locator("#agents")
    .getByRole("button", { name: "Revoke Playwright agent" })
    .click();
  await expect(page.locator("#agents").getByText("Revoked")).toBeVisible();
  expect((await call("tools/list")).status).toBe(401);
  await request.dispose();
});
