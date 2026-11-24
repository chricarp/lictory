import { createHash } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import * as s from "@lictory/core/db/schema";
import {
  currentRevision,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
} from "../helpers/seed";
import { clientAddress } from "../helpers/client-address";

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
        structuredContent?: Record<string, unknown>;
        content?: { text: string }[];
      };
    };
    expect(body.result.isError, JSON.stringify(body)).toBeFalsy();
    return body.result.structuredContent!;
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
  await expect(card.locator('[data-claim="active"]')).toContainText("Forge");

  // The item says who holds it and what Done needs.
  await page.goto(seeded.itemPath(2));
  const factory = page.getByRole("region", { name: "Agent claim" });
  await expect(factory.getByText("Forge via Ada Forge")).toBeVisible();
  await expect(factory.getByText("Working")).toBeVisible();
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
  await factory.getByRole("button", { name: "Release" }).click();
  const dialog = page.getByRole("dialog", { name: "Release this claim?" });
  await dialog.getByLabel("Note (optional)").fill("Taking this one myself.");
  await dialog.getByRole("button", { name: "Release" }).click();
  await expect(factory.getByText("Agents can claim this now.")).toBeVisible();
  await expect(
    page.getByText("Taking this one myself.", { exact: false }),
  ).toBeVisible();
  await request.dispose();
});
