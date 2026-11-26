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
// One person per workflow, so each starts without an organization.
const ownerEmail = "scout-owner@example.test";

test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  for (const [address, name, handle] of [
    [email, "Avery Agent", "avery_agent"],
    [ownerEmail, "Sam Scout", "sam_scout"],
  ] as const) {
    const id = crypto.randomUUID();
    const inserted = await db
      .insert(s.user)
      .values({ id, name, email: address, emailVerified: true, handle })
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
  }
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
    .getByRole("button", { name: "Create an organization", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "Agent Co",
    project: "Agent project",
    key: "AGT",
  });
  const workspaceUrl = page.url();

  // Create a personal token in account settings; the secret is shown once.
  await page.goto("/account#tokens");
  const section = page.locator("#tokens");
  await section.getByRole("button", { name: "New token" }).click();
  await section.getByLabel("Name", { exact: true }).fill("Playwright agent");
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
  await page.goto("/account#tokens");
  await page
    .locator("#tokens")
    .getByRole("button", { name: "Revoke Playwright agent" })
    .click();
  await expect(page.locator("#tokens").getByText("Revoked")).toBeVisible();
  expect((await call("tools/list")).status).toBe(401);
  await request.dispose();
});

test("an external agent is connected and woken from its own page", async ({
  page,
  playwright,
  baseURL,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(inApp);
  await page
    .getByRole("button", { name: "Create an organization", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "Scout Co",
    project: "Scout project",
    key: "SCT",
  });
  const slug = new URL(page.url()).pathname.split("/")[1]!;

  // Creating an external agent opens its page on Connection, with its first
  // token shown once and the MCP setup.
  await page.goto(`/${slug}/factory/agents`);
  await page.getByRole("button", { name: "New agent" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New agent" });
  await dialog.getByText("External MCP client").click();
  await dialog.getByLabel("Name", { exact: true }).fill("Scout");
  await dialog.getByRole("button", { name: "Create agent" }).click();
  await expect(page).toHaveURL(/\/factory\/agents\/[^/#]+#connection$/);
  const connection = page.locator("#connection");
  const secret = (
    await connection.getByTestId("agent-token-secret").textContent()
  )?.trim();
  expect(secret).toMatch(/^lct_/);
  await expect(connection.getByTestId("agent-mcp-url")).toHaveText(
    `${new URL(page.url()).origin}/api/mcp`,
  );
  await expect(connection.getByLabel("Setup", { exact: true })).toContainText(
    "claude mcp add",
  );
  // Single quotes keep the variable's name in the client's configuration;
  // the shell would otherwise write the token itself there.
  await expect(connection.getByLabel("Setup", { exact: true })).toContainText(
    "'Authorization: Bearer ${LICTORY_TOKEN}'",
  );
  await expect(connection.getByTestId("agent-token")).toHaveCount(1);

  // The token authenticates as the agent: one organization, its own.
  const request = await playwright.request.newContext({ baseURL });
  const call = mcp(request, secret!);
  const { body } = await call("tools/call", {
    name: "listOrganizations",
    arguments: {},
  });
  expect(body?.result?.isError, JSON.stringify(body)).toBe(false);
  const { organizations } = body!.result!.structuredContent! as {
    organizations: { slug: string }[];
  };
  expect(organizations.map((o) => o.slug)).toEqual([slug]);

  // Shown once: the page no longer holds it after a reload.
  await page.reload();
  await expect(connection.getByTestId("agent-token")).toHaveCount(1);
  await expect(connection.getByTestId("agent-token-secret")).toHaveCount(0);
  // Its owner sees what it called.
  const activity = page.getByRole("region", { name: /Recent activity/ });
  await expect(activity.getByText("listOrganizations")).toBeVisible();

  // A wake-up added on the agent's page is listed there.
  const wakeUps = page.locator("#wake-ups");
  await wakeUps.getByRole("button", { name: "New webhook" }).click();
  const form = wakeUps.getByRole("form", { name: "New webhook" });
  await form.getByLabel("Name", { exact: true }).fill("Scout routine");
  await form
    .getByLabel("URL", { exact: true })
    .fill("https://hooks.example.com/scout");
  await form.getByLabel("Bearer secret", { exact: true }).fill("scout-secret");
  await form.getByRole("button", { name: "Add webhook" }).click();
  const hook = wakeUps.getByTestId("event-webhook");
  await expect(hook.getByText("Scout routine")).toBeVisible();
  await expect(hook.getByText("Active", { exact: true })).toBeVisible();

  // Phones: the page fits the width.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(hook.getByText("Scout routine")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Account settings lists neither the agent's token nor its webhook; it
  // points to the agent's page instead.
  await page.goto("/account#webhooks");
  const webhooks = page.locator("#webhooks");
  const link = webhooks.getByRole("link", { name: /Scout/ });
  await expect(link).toBeVisible();
  await expect(webhooks.getByText("Scout routine")).toHaveCount(0);
  await expect(page.locator("#tokens").getByText("Scout")).toHaveCount(0);
  await link.click();
  await expect(page).toHaveURL(/\/factory\/agents\/[^/#]+#wake-ups$/);
  await expect(
    page.locator("#wake-ups").getByText("Scout routine"),
  ).toBeVisible();

  // Revoking on the agent's page disconnects its client at once.
  await page
    .locator("#connection")
    .getByRole("button", { name: /^Revoke token/ })
    .click();
  await expect(
    page.locator("#connection").getByTestId("agent-token"),
  ).toHaveCount(0);
  await expect(
    page.locator("#connection").getByText("No active token."),
  ).toBeVisible();
  expect((await call("tools/list")).status).toBe(401);
  await request.dispose();
});
