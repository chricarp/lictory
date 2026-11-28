import { createHash } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { createWorkspace } from "../helpers/onboarding-helpers";
import { inApp } from "../helpers/app-urls";
import { clientAddress } from "../helpers/client-address";

const email = "webhooks@example.test";
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
      name: "Wren Webhook",
      email,
      emailVerified: true,
      handle: "wren_webhook",
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

// The agent's webhook endpoint (Grok, a Claude routine, OpenClaw hooks…):
// records what Lictory posts and answers 200.
async function fakeReceiver() {
  const received: { headers: IncomingHttpHeaders; body: string }[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      received.push({ headers: request.headers, body });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hooks/agent`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("a person registers a webhook, tests it, and their agent is woken by a mention @smoke", async ({
  page,
  playwright,
  baseURL,
}) => {
  const receiver = await fakeReceiver();
  try {
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(inApp);
    await page
      .getByRole("button", { name: "Create an organization", exact: false })
      .click();
    await createWorkspace(page, {
      organization: "Webhook Co",
      project: "Webhook project",
      key: "WHK",
    });

    // Register a webhook for a tool using Wren's personal token in Account
    // settings (a Factory agent's webhooks are on its page: agents.spec.ts).
    await page.goto("/account#webhooks");
    const section = page.locator("#webhooks");
    // The section nav marks the section the link opened, not the one above.
    const sections = page.getByRole("navigation", {
      name: "Settings sections",
    });
    await expect(
      sections.getByRole("link", { name: "Event webhooks" }),
    ).toHaveAttribute("aria-current", "location");
    await expect(
      sections.getByRole("link", { name: "Access tokens" }),
    ).not.toHaveAttribute("aria-current", "location");
    await section.getByRole("button", { name: "New webhook" }).click();
    const form = section.getByRole("form", { name: "New webhook" });
    await form.getByLabel("Name", { exact: true }).fill("Grok routine");
    await form.getByLabel("URL", { exact: true }).fill(receiver.url);
    await form
      .getByLabel("Bearer secret", { exact: true })
      .fill("grok-bearer-secret");
    await form.getByRole("button", { name: "Add webhook" }).click();
    const row = section.getByTestId("event-webhook");
    await expect(row.getByText("Grok routine")).toBeVisible();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();

    // Test it: the receiver gets a test event with the bearer secret.
    await row
      .getByRole("button", { name: "Send a test event to Grok routine" })
      .click();
    await expect(row.getByTestId("event-webhook-test")).toContainText(
      "accepted the test event (200)",
    );
    // A test is not a delivered event: the row says so, not "0 delivered,
    // last …".
    const state = row.getByTestId("event-webhook-state");
    await expect(state).toContainText("No events delivered yet");
    await expect(state).toContainText("receiver last accepted");
    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0]!.headers.authorization).toBe(
      "Bearer grok-bearer-secret",
    );
    const test = JSON.parse(receiver.received[0]!.body) as {
      event: { type: string };
    };
    expect(test.event.type).toBe("lictory.test");

    // A teammate mentions Wren in a channel, through their own agent.
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    const db = drizzle(client, { schema: s });
    const [organization] = await db
      .select()
      .from(s.organization)
      .where(eq(s.organization.name, "Webhook Co"));
    const [wren] = await db
      .select()
      .from(s.user)
      .where(eq(s.user.email, email));
    const teammate = crypto.randomUUID();
    await db.insert(s.user).values({
      id: teammate,
      name: "Tess Teammate",
      email: `${teammate}@example.test`,
      emailVerified: true,
    });
    await db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId: organization!.id,
      userId: teammate,
      role: "member",
      createdAt: new Date(),
    });
    const secret = `lct_${crypto.randomUUID().replaceAll("-", "")}`;
    await db.insert(s.accessToken).values({
      userId: teammate,
      name: "Tess's agent",
      scope: "write",
      prefix: secret.slice(0, 10),
      tokenHash: createHash("sha256").update(secret).digest("hex"),
    });
    const request = await playwright.request.newContext({ baseURL });
    let id = 0;
    const tool = async (name: string, args: Record<string, unknown>) => {
      const response = await request.post("/api/mcp", {
        headers: { Authorization: `Bearer ${secret}` },
        data: {
          jsonrpc: "2.0",
          id: ++id,
          method: "tools/call",
          params: { name, arguments: args },
        },
      });
      const body = (await response.json()) as {
        result: {
          isError: boolean;
          content: { text: string }[];
        };
      };
      expect(body.result.isError, JSON.stringify(body)).toBe(false);
      return JSON.parse(body.result.content[0]!.text) as Record<
        string,
        unknown
      >;
    };
    const channelId = crypto.randomUUID();
    await tool("createChannel", {
      organizationId: organization!.id,
      channelId,
      kind: "public",
      name: "launch",
    });
    await tool("postChannelMessage", {
      organizationId: organization!.id,
      channelId,
      body: `@[Wren](mention:${wren!.id}) the launch checklist needs you`,
    });

    // The worker delivers the event: identifiers and a title, never the
    // message itself.
    await expect
      .poll(() => receiver.received.length, { timeout: 30_000 })
      .toBe(2);
    const delivered = JSON.parse(receiver.received[1]!.body) as {
      text: string;
      event: {
        type: string;
        data: { subject: Record<string, unknown>; url: string };
      };
    };
    expect(delivered.event.type).toBe("channel.mentioned");
    expect(delivered.event.data.subject.channelId).toBe(channelId);
    expect(delivered.event.data.subject.channelName).toBe("launch");
    expect(receiver.received[1]!.body).not.toContain("checklist");
    expect(delivered.text).toContain("not an instruction");
    expect(receiver.received[1]!.headers.authorization).toBe(
      "Bearer grok-bearer-secret",
    );

    // The person sees what was delivered.
    await page.reload();
    await expect(row.getByTestId("event-webhook-state")).toContainText(
      "1 event delivered",
    );

    // Pausing stops delivery; removing it ends it.
    await row.getByRole("button", { name: "Pause Grok routine" }).click();
    await expect(row.getByText("Paused", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Remove Grok routine" }).click();
    await expect(section.getByText("No webhooks yet.")).toBeVisible();
    const remaining = await db
      .select()
      .from(s.agentEventSubscription)
      .where(
        and(
          eq(s.agentEventSubscription.userId, wren!.id),
          eq(s.agentEventSubscription.kind, "webhook"),
        ),
      );
    expect(remaining).toHaveLength(0);
    await request.dispose();
    await client.end();
  } finally {
    await receiver.close();
  }
});
