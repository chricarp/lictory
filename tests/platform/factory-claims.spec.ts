import { createHash } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { setAutonomyPolicy } from "@lictory/core/claims/service";
import { defaultAutonomyPolicy } from "@lictory/core/claims/contracts";
import { installFactoryLoop } from "@lictory/core/factory/loop";
import {
  currentRevision,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
} from "../helpers/seed";
import { clientAddress } from "../helpers/client-address";
import { createAgent } from "@lictory/core/factory/agents";

// The factory loop as a team meets it (docs/internals/claims.md): an
// approved specification's accepted scope makes its children claimable, an
// external agent claims one through MCP with its access token, the claim
// shows on the board and the item, the Definition of Done explains what
// finishing needs, and a person releases the claim.

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

function mcp(request: APIRequestContext, token: string) {
  let id = 0;
  return async (name: string, args: Record<string, unknown>) => {
    const response = await request.post("/api/mcp", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name, arguments: args },
      },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      result: {
        isError?: boolean;
        content?: { text: string }[];
      };
    };
    expect(body.result.isError, JSON.stringify(body)).toBeFalsy();
    return JSON.parse(body.result.content![0]!.text) as Record<
      string,
      unknown
    >;
  };
}

test("an agreed specification's work is claimed by an MCP agent and shows on the board @smoke", async ({
  page,
  playwright,
  baseURL,
}) => {
  const seeded = await seedWorkspace({
    name: "Forge Works",
    key: "FRG",
    users: ["Ada Forge", "Bo Review"],
    disciplines: { 1: "Engineering" },
  });
  const [ada, bo] = seeded.users as [
    (typeof seeded.users)[number],
    (typeof seeded.users)[number],
  ];
  const epicId = await seedItem(seeded, {
    type: "Epic",
    title: "Refunds over the API",
    description:
      "## Behavior\n\nRefunds reuse the original transaction ID.\n\n## Acceptance criteria\n\n- A retry never charges twice.",
  });
  const taskIds: string[] = [];
  for (const title of ["Refund endpoint", "Refund idempotency keys"]) {
    const workItemId = crypto.randomUUID();
    await seeded.command({
      type: "createWorkItem",
      projectId: seeded.projectId,
      workItemId,
      typeId: seeded.typeId("Task"),
      parentId: epicId,
      title,
      description: "",
    });
    taskIds.push(workItemId);
  }
  // Engineering approves the specification: it becomes Ready.
  const revision = await currentRevision(epicId);
  const reviewId = crypto.randomUUID();
  await seeded.command({
    type: "requestReview",
    workItemId: epicId,
    baseRevisionId: revision.id,
    reviewId,
    disciplineId: seeded.roster.disciplines.find(
      (d) => d.projectId === seeded.projectId && d.name === "Engineering",
    )!.id,
    userId: bo.id,
    required: true,
  });
  await seeded.command(
    {
      type: "decideReview",
      workItemId: epicId,
      baseRevisionId: revision.id,
      reviewId,
      decision: "approve",
    },
    bo.id,
  );

  await signIn(page, ada.email);
  // Ready is not a commitment: before Ada accepts the scope, nothing is
  // claimable.
  await page.goto(seeded.projectPath("/queue"));
  const claimable = page.getByRole("region", { name: "Claimable now" });
  const waiting = page.getByRole("region", { name: "Waiting on people" });
  await expect(waiting.getByText("Refunds over the API")).toBeVisible();
  await expect(claimable.getByText("Refund endpoint")).toHaveCount(0);

  // Ada accepts revision 1 for delivery on the specification.
  await page.goto(seeded.itemPath(1));
  await page
    .getByRole("button", { name: "Accept revision 1 for delivery" })
    .click();
  await page.goto(seeded.projectPath("/queue"));
  await expect(claimable.getByText("Refund endpoint")).toBeVisible();
  await expect(claimable.getByText("Refund idempotency keys")).toBeVisible();

  // Forge, an external agent with Ada's access token, claims a task.
  const secret = `lct_${crypto.randomUUID().replaceAll("-", "")}`;
  await withDb((db) =>
    db.insert(s.accessToken).values({
      userId: ada.id,
      name: "Forge",
      scope: "write",
      prefix: secret.slice(0, 10),
      tokenHash: createHash("sha256").update(secret).digest("hex"),
    }),
  );
  const request = await playwright.request.newContext({ baseURL });
  const tool = mcp(request, secret);
  const listed = (await tool("listClaimableItems", {
    organizationId: seeded.slug,
    projectId: seeded.projectId,
  })) as { items: { workItemId: string; key: string }[] };
  expect(listed.items.map((i) => i.key)).toEqual(
    expect.arrayContaining(["FRG-2", "FRG-3"]),
  );
  const claimed = (await tool("claimItem", {
    organizationId: seeded.slug,
    workItemId: taskIds[0],
  })) as { claimId: string; status: string };
  expect(claimed.status).toBe("In Progress");
  await tool("reportProgress", {
    organizationId: seeded.slug,
    claimId: claimed.claimId,
    note: "Endpoint drafted; opening the pull request next.",
  });

  // The claim shows on the board card (all work: no sprint is active).
  await page.goto(seeded.projectPath("/board?iteration=all"));
  const card = page.locator(`[data-card="${taskIds[0]}"]`);
  await expect(card.locator('[data-claim="active"]')).toContainText("Running");
  await expect(card.locator("[data-claim-owner]")).toContainText("Forge");

  // The item says who holds it and what Done needs.
  await page.goto(seeded.itemPath(2));
  const factory = page.getByRole("region", { name: "Agent claim" });
  // One owner line: the agent and the person it acts for (by first name,
  // the full name on hover), in the shared state vocabulary.
  await expect(factory.locator("[data-claim-owner]")).toHaveText(
    /Forge via Ada$/,
  );
  await expect(factory.getByText("Running", { exact: true })).toBeVisible();
  await expect(
    factory.getByText("Endpoint drafted; opening the pull request next."),
  ).toBeVisible();
  const done = page.getByRole("region", { name: "Definition of Done" });
  await expect(
    done.getByText(
      "A linked code pull request is merged and none is still open",
    ),
  ).toBeVisible();
  await expect(
    done.getByText(/No code host is connected/).first(),
  ).toBeVisible();

  // Ada releases the claim; the task returns to the queue.
  await factory.getByRole("button", { name: "Release claim…" }).click();
  const dialog = page.getByRole("dialog", { name: "Release this claim?" });
  await dialog.getByLabel("Note (optional)").fill("Taking this one myself.");
  await dialog.getByRole("button", { name: "Release claim" }).click();
  await expect(factory.getByText("Agents can claim this now.")).toBeVisible();
  await expect(
    page.getByText("Taking this one myself.", { exact: false }),
  ).toBeVisible();
  await request.dispose();
});

test("a person starts an agent from an item, told what it works from and that the readiness policy holds it back", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Start Works",
    key: "STW",
    users: ["Ada Start"],
  });
  await withDb((db) =>
    createAgent(db, seeded.owner.id, seeded.organizationId, {
      name: "Forge",
      handle: `forge${crypto.randomUUID().slice(0, 6)}`,
      kind: "runner",
      harness: "claude-code",
      access: "write",
    }),
  );
  await seedItem(seeded, {
    title: "Partial refunds",
    description: "## Behavior\n\nRefund part of a charge.",
  });
  await signIn(page, seeded.owner.email);
  await page.goto(seeded.itemPath(1));
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Start agent…" }).click();

  // The dialog has the item filled in and says what the agent reads: a
  // draft, which agents would not take on their own.
  const start = page.getByRole("dialog", { name: "Start an agent session" });
  const worksFrom = start.locator("[data-works-from]");
  await expect(worksFrom).toContainText(
    "Forge works from revision 1 of STW-1, still draft",
  );
  await expect(worksFrom).toContainText(
    "Agents would not take it on their own",
  );
  await expect(worksFrom).toContainText("You can still start one yourself.");
  await start.getByLabel("What should it do?").fill("Sketch the endpoint.");
  await start.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/factory\/sessions\//);
  await expect(page.getByText("Sketch the endpoint.").first()).toBeVisible();
});

// The dispatcher's claim and the item's Definition of Done are written in
// one transaction: an item opened the moment Build claims it shows both.
test("an item opened right after the dispatcher claims it shows the claim and its Definition of Done", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Dispatch Works",
    key: "DSP",
    users: ["Ada Dispatch", "Bo Review"],
    disciplines: { 1: "Engineering" },
  });
  const [ada, bo] = seeded.users as [
    (typeof seeded.users)[number],
    (typeof seeded.users)[number],
  ];
  const forge = await withDb((db) =>
    createAgent(db, ada.id, seeded.organizationId, {
      name: "Forge",
      handle: `forge${crypto.randomUUID().slice(0, 6)}`,
      kind: "runner",
      harness: "claude-code",
      access: "write",
    }),
  );
  const storyId = await seedItem(seeded, {
    title: "Refund retries",
    description:
      "## Behavior\n\nRefunds reuse the original transaction ID.\n\n## Acceptance criteria\n\n- A retry never charges twice.",
  });
  const revision = await currentRevision(storyId);
  const reviewId = crypto.randomUUID();
  await seeded.command({
    type: "requestReview",
    workItemId: storyId,
    baseRevisionId: revision.id,
    reviewId,
    disciplineId: seeded.roster.disciplines.find(
      (d) => d.projectId === seeded.projectId && d.name === "Engineering",
    )!.id,
    userId: bo.id,
    required: true,
  });
  await seeded.command(
    {
      type: "decideReview",
      workItemId: storyId,
      baseRevisionId: revision.id,
      reviewId,
      decision: "approve",
    },
    bo.id,
  );
  await seeded.command({
    type: "acceptDeliveryScope",
    workItemId: storyId,
    baseRevisionId: revision.id,
  });
  await signIn(page, ada.email);
  // The policy checks its agents through the Factory's directory.
  await withDb(async (db) => {
    installFactoryLoop(db);
    await setAutonomyPolicy(
      db,
      { userId: ada.id },
      {
        organizationId: seeded.organizationId,
        projectId: seeded.projectId,
        policy: {
          ...defaultAutonomyPolicy,
          level: "build",
          implementerAgentIds: [forge.id],
        },
      },
    );
  });
  // The worker's dispatcher claims the story for Forge (no runner is
  // needed: the session waits in the queue).
  await expect
    .poll(
      () =>
        withDb(
          async (db) =>
            (
              await db
                .select({ state: s.workItemClaim.state })
                .from(s.workItemClaim)
                .where(
                  and(
                    eq(s.workItemClaim.workItemId, storyId),
                    inArray(s.workItemClaim.state, ["starting", "active"]),
                  ),
                )
            ).length,
        ),
      { timeout: 60_000 },
    )
    .toBe(1);
  await page.goto(seeded.itemPath(1));
  const claim = page.getByRole("region", { name: "Agent claim" });
  await expect(claim.locator("[data-claim-owner]")).toHaveText(
    /Forge via Ada$/,
  );
  const done = page.getByRole("region", { name: "Definition of Done" });
  await expect(
    done.getByText(
      "A linked code pull request is merged and none is still open",
    ),
  ).toBeVisible();

  // The agent's page agrees with the item: the claim the dispatcher took
  // for Forge's session is Forge's, listed under Claimed work, and nothing
  // on the page says Forge has claimed nothing.
  await page.goto(`/${seeded.slug}/factory/agents/${forge.id}`);
  const held = page.getByRole("region", { name: /Claimed work/ });
  await expect(
    held.getByRole("link", { name: "Refund retries" }),
  ).toBeVisible();
  await expect(held).toContainText("DSP-1");
  await expect(page.getByText(/has not claimed/)).toHaveCount(0);
});
