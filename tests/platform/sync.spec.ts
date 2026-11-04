import { test, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { appHome, platformOrigin } from "../helpers/app-urls";
import {
  currentRevision,
  newPerson,
  password,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
} from "../helpers/seed";
import {
  waitUntilSaved,
  waitUntilStoredLocally,
} from "../helpers/sync-helpers";
import { controlZeroConnection } from "../helpers/zero-socket";

// Collaboration through Zero against the real stack: what one person does
// reaches the others without reloading, the server stays authoritative, and
// nothing a person wrote is lost when the server refuses it.

const properties = (page: Page) =>
  page.getByRole("heading", { name: "Properties", exact: true }).locator("..");

// The item's own rows (revisions, discussions, capabilities) arrive after its
// title: the page is usable once the discussion composer is offered.
async function opened(page: Page, title: string) {
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Start a discussion" }),
  ).toBeVisible();
  await expect(
    properties(page).getByRole("button", { name: /^Priority:/ }),
  ).toBeVisible();
}

async function priorityOf(workItemId: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select({ priority: s.workItem.priority })
      .from(s.workItem)
      .where(eq(s.workItem.id, workItemId));
    return row!.priority;
  });
}

async function discussionsOf(workItemId: string) {
  return withDb((db) =>
    db
      .select({ body: s.threadMessage.body })
      .from(s.threadMessage)
      .innerJoin(s.thread, eq(s.thread.id, s.threadMessage.threadId))
      .where(eq(s.thread.workItemId, workItemId)),
  );
}

async function setPriority(page: Page, label: string) {
  await properties(page)
    .getByRole("button", { name: /^Priority:/ })
    .click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(
    properties(page).getByRole("button", {
      name: `Priority: ${label}`,
      exact: true,
    }),
  ).toBeVisible();
}

async function openSyncDialog(page: Page) {
  await page
    .getByRole("button", {
      name: /Everything is saved|Saving|Reconnecting|offline|Sync needs your help/,
    })
    .click();
  return page.getByRole("dialog", { name: "Workspace sync" });
}

function seed(key: string) {
  return seedWorkspace({
    name: `Sync ${key}`,
    key,
    users: ["Ada Owner", "Ben Writer"],
    disciplines: { 0: "Product", 1: "Product" },
  });
}

test("two people see each other's work live; concurrent specification edits never overwrite each other @smoke", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const seeded = await seed("LIVE");
  const workItemId = await seedItem(seeded, {
    title: "Settlement retries",
    description: "# Behavior\n\nRetries reuse the transaction ID.",
  });
  const ada = await newPerson(browser, "192.0.2.160");
  const ben = await newPerson(browser, "192.0.2.161");
  try {
    await signIn(ada.page, seeded.users[0]!.email);
    await signIn(ben.page, seeded.users[1]!.email);
    await ben.page.goto(seeded.projectPath("/items"));
    await expect(
      ben.page.getByRole("link", { name: "Settlement retries" }),
    ).toBeVisible();

    // A new item appears in the other person's list.
    await ada.page.goto(seeded.projectPath("/items"));
    await ada.page
      .getByRole("button", { name: "New item", exact: true })
      .click();
    await ada.page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Chargeback notices");
    await ada.page
      .getByRole("dialog", { name: "Create story" })
      .getByRole("button", { name: "Create another", exact: true })
      .click();
    await expect(
      ben.page.getByRole("link", { name: "Chargeback notices" }),
    ).toBeVisible();

    // Property changes, discussions and replies travel both ways.
    await ada.page.goto(seeded.itemPath(1));
    await ben.page.goto(seeded.itemPath(1));
    await setPriority(ada.page, "High");
    await expect(
      properties(ben.page).getByRole("button", {
        name: "Priority: High",
        exact: true,
      }),
    ).toBeVisible();
    await ada.page
      .getByRole("textbox", { name: "Start a discussion" })
      .fill("Which retries reuse the original ID?");
    await ada.page.getByRole("button", { name: "Post", exact: true }).click();
    const benThread = ben.page
      .getByRole("article", { name: "discussion" })
      .filter({ hasText: "Which retries reuse the original ID?" });
    await expect(benThread).toBeVisible();
    await benThread.getByRole("button", { name: "Reply", exact: true }).click();
    await ben.page
      .getByRole("textbox", { name: "Reply" })
      .fill("All of them, including late callbacks.");
    await benThread.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(
      ada.page.getByText("All of them, including late callbacks."),
    ).toBeVisible();

    // Both edit revision 1. Ada saves first; Ben is told and keeps his text.
    await ada.page.getByRole("button", { name: "Edit", exact: true }).click();
    await ben.page.getByRole("button", { name: "Edit", exact: true }).click();
    const benDraft =
      "# Behavior\n\nRetries reuse the transaction ID for 24 hours.";
    await ben.page
      .getByRole("textbox", { name: "Specification" })
      .fill(benDraft);
    await ada.page
      .getByRole("textbox", { name: "Specification" })
      .fill("# Behavior\n\nRetries reuse the original transaction ID.");
    await ada.page.getByRole("button", { name: /Save revision 2/ }).click();
    await expect(ada.page.getByText("Revision 2 ·").first()).toBeVisible();
    await expect(
      ben.page.getByText(
        "Revision 2 was saved while you were editing revision 1",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      ben.page.getByRole("button", { name: /Save revision/ }),
    ).toBeDisabled();
    await expect(
      ben.page.getByRole("textbox", { name: "Specification" }),
    ).toHaveValue(benDraft);
    expect((await currentRevision(workItemId)).content).toContain(
      "original transaction ID",
    );
  } finally {
    await ada.context.close();
    await ben.context.close();
  }
});

test("a specification saved against an outdated revision is refused by the server and its text stays recoverable", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const seeded = await seed("STALE");
  const workItemId = await seedItem(seeded, {
    title: "Payout schedule",
    description: "# Behavior\n\nPayouts run daily.",
  });
  const ben = await newPerson(browser, "192.0.2.162");
  try {
    const zero = await controlZeroConnection(ben.context);
    await signIn(ben.page, seeded.users[1]!.email);
    await ben.page.goto(seeded.itemPath(1));
    await opened(ben.page, "Payout schedule");
    await waitUntilSaved(ben.page);
    // Ben loses the connection; meanwhile Ada saves revision 2.
    await zero.interrupt();
    const base = await currentRevision(workItemId);
    await seeded.command({
      type: "updateSpecification",
      workItemId,
      baseRevisionId: base.id,
      title: "Payout schedule",
      content: "# Behavior\n\nPayouts run hourly.",
    });
    // Ben's view still shows revision 1, so his edit is based on it.
    await ben.page.getByRole("button", { name: "Edit", exact: true }).click();
    const draft = "# Behavior\n\nPayouts run weekly on Fridays.";
    await ben.page.getByRole("textbox", { name: "Specification" }).fill(draft);
    await ben.page.getByRole("button", { name: /Save revision 2/ }).click();
    zero.restore();
    const toast = ben.page.locator('[data-slot="toast"]', {
      hasText: "Change not applied",
    });
    await expect(toast).toContainText("The specification changed", {
      timeout: 30_000,
    });
    await expect(toast).toContainText("Your text is kept on this device.");
    // The server kept Ada's revision; nothing was merged silently.
    const latest = await currentRevision(workItemId);
    expect(latest.number).toBe(2);
    expect(latest.content).toContain("hourly");
    await expect(ben.page.getByText("Payouts run hourly.")).toBeVisible();
    // The draft survives a reload, listed with the reason.
    // The refused change is settled; nothing is waiting for the server.
    await ben.page.reload();
    const dialog = await openSyncDialog(ben.page);
    await expect(dialog.getByText("Not saved", { exact: true })).toBeVisible();
    await expect(dialog).toContainText("Specification edit");
    await expect(dialog).toContainText("Payouts run weekly on Fridays.");
  } finally {
    await ben.context.close();
  }
});

test("a comment on an item archived meanwhile is rolled back, explained and recoverable after reload", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const seeded = await seed("ARCH");
  const workItemId = await seedItem(seeded, { title: "Legacy exports" });
  const ben = await newPerson(browser, "192.0.2.163");
  try {
    const zero = await controlZeroConnection(ben.context);
    await signIn(ben.page, seeded.users[1]!.email);
    await ben.page.goto(seeded.itemPath(1));
    await opened(ben.page, "Legacy exports");
    await waitUntilSaved(ben.page);
    await zero.interrupt();
    await seeded.command({
      type: "archiveWorkItem",
      workItemId,
      archived: true,
    });
    const text = "Exports older than a year move to cold storage.";
    await ben.page
      .getByRole("textbox", { name: "Start a discussion" })
      .fill(text);
    await ben.page.getByRole("button", { name: "Post", exact: true }).click();
    const comment = ben.page
      .getByRole("article", { name: "discussion" })
      .getByText(text);
    // Shown at once while it waits for the server.
    await expect(comment).toBeVisible();
    zero.restore();
    await expect(
      ben.page.locator('[data-slot="toast"]', {
        hasText: "Change not applied",
      }),
    ).toContainText("Restore this item before changing it.", {
      timeout: 30_000,
    });
    // The optimistic comment is rolled back; the item shows it is archived.
    await expect(comment).toHaveCount(0);
    await expect(ben.page.getByText("Archived", { exact: true })).toBeVisible();
    expect(await discussionsOf(workItemId)).toEqual([]);
    // The refused change is settled; nothing is waiting for the server.
    await ben.page.reload();
    await expect(comment).toHaveCount(0);
    const dialog = await openSyncDialog(ben.page);
    await expect(dialog).toContainText("Comment");
    await expect(dialog).toContainText(text);
    await expect(dialog).toContainText("Restore this item before changing it.");
    // Discarding is explicit and final.
    await dialog.getByRole("button", { name: "Discard" }).click();
    await expect(dialog.getByText("Not saved", { exact: true })).toHaveCount(0);
  } finally {
    await ben.context.close();
  }
});

test("removing a member takes the organization away from their open workspace and refuses their changes @smoke", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const seeded = await seed("GONE");
  const workItemId = await seedItem(seeded, { title: "Dispute evidence" });
  const ada = await newPerson(browser, "192.0.2.164");
  const ben = await newPerson(browser, "192.0.2.165");
  try {
    await signIn(ada.page, seeded.users[0]!.email);
    const zero = await controlZeroConnection(ben.context);
    await signIn(ben.page, seeded.users[1]!.email);
    await ben.page.goto(seeded.itemPath(1));
    await opened(ben.page, "Dispute evidence");
    await waitUntilSaved(ben.page);
    // A change Ben makes from a view that is about to lose access.
    await zero.interrupt();
    await setPriority(ben.page, "Urgent");

    const removed = await ada.page.request.post(
      "/api/auth/organization/remove-member",
      {
        data: {
          memberIdOrEmail: seeded.users[1]!.email,
          organizationId: seeded.organizationId,
        },
        headers: { Origin: platformOrigin },
      },
    );
    expect(removed.status()).toBe(200);
    zero.restore();

    await expect(
      ben.page.getByRole("dialog", {
        name: "Organization access has been removed.",
      }),
    ).toBeVisible({ timeout: 30_000 });
    // The change made from the outdated view was refused, not applied.
    await expect(
      ben.page.getByRole("dialog", { name: "Change not applied" }),
    ).toContainText("You are not a member of this organization.");
    await expect(ben.page).toHaveURL(appHome);
    await expect(ben.page.getByText("Dispute evidence")).toHaveCount(0);
    await expect(ben.page.getByText("Sync GONE")).toHaveCount(0);
    expect(await priorityOf(workItemId)).toBe("none");
    // The address no longer opens anything.
    await ben.page.goto(seeded.itemPath(1));
    await expect(
      ben.page.getByRole("heading", { name: "This workspace was not found" }),
    ).toBeVisible();
    await expect(ben.page.getByText("Dispute evidence")).toHaveCount(0);
  } finally {
    await ada.context.close();
    await ben.context.close();
  }
});

test("changes made offline survive a reload, apply once back online and reach other tabs and people", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const seeded = await seed("OFFL");
  const workItemId = await seedItem(seeded, { title: "Ledger export" });
  const ada = await newPerson(browser, "192.0.2.166");
  const ben = await newPerson(browser, "192.0.2.167");
  try {
    await signIn(ada.page, seeded.users[0]!.email);
    await ada.page.goto(seeded.itemPath(1));
    const zero = await controlZeroConnection(ben.context);
    await signIn(ben.page, seeded.users[1]!.email);
    await ben.page.goto(seeded.itemPath(1));
    const second = await ben.context.newPage();
    await second.goto(seeded.itemPath(1));
    await expect(
      second.getByRole("heading", { name: "Ledger export", level: 1 }),
    ).toBeVisible();
    await waitUntilSaved(ben.page);
    await waitUntilSaved(second);

    // Two tabs of one person share their unsent changes immediately.
    await setPriority(ben.page, "Medium");
    await expect(
      properties(second).getByRole("button", {
        name: "Priority: Medium",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      properties(ada.page).getByRole("button", {
        name: "Priority: Medium",
        exact: true,
      }),
    ).toBeVisible();

    await ben.context.setOffline(true);
    await zero.interrupt();
    await setPriority(ben.page, "Low");
    const text = "Exports include reversed entries.";
    await ben.page
      .getByRole("textbox", { name: "Start a discussion" })
      .fill(text);
    await ben.page.getByRole("button", { name: "Post", exact: true }).click();
    await expect(
      ben.page.getByRole("article", { name: "discussion" }).getByText(text),
    ).toBeVisible();
    await expect(
      properties(second).getByRole("button", {
        name: "Priority: Low",
        exact: true,
      }),
    ).toBeVisible();
    // Nothing reached the server yet.
    expect(await priorityOf(workItemId)).toBe("medium");

    // Back online but still without a workspace connection: a reload keeps
    // the unsent work, kept by Zero on this device.
    await ben.context.setOffline(false);
    await ben.page.reload();
    await expect(
      properties(ben.page).getByRole("button", {
        name: "Priority: Low",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      ben.page.getByRole("article", { name: "discussion" }).getByText(text),
    ).toBeVisible();

    zero.restore();
    await expect(
      properties(ada.page).getByRole("button", {
        name: "Priority: Low",
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      ada.page.getByRole("article", { name: "discussion" }).getByText(text),
    ).toBeVisible();
    await waitUntilSaved(ben.page);
    expect(await priorityOf(workItemId)).toBe("low");
    // Applied exactly once.
    expect(
      (await discussionsOf(workItemId)).filter((m) => m.body === text),
    ).toHaveLength(1);
  } finally {
    await ada.context.close();
    await ben.context.close();
  }
});

test("signing out removes the workspace from the browser before someone else signs in", async ({
  browser,
}) => {
  const seeded = await seed("SWAP");
  await seedItem(seeded, { title: "Confidential roadmap item" });
  const other = await seedWorkspace({
    name: "Other Company",
    key: "OTH",
    users: ["Cleo Other"],
  });
  const shared = await newPerson(browser, "192.0.2.168");
  const page = shared.page;
  try {
    await signIn(page, seeded.users[0]!.email);
    await page.goto(seeded.itemPath(1));
    await expect(
      page.getByRole("heading", { name: "Confidential roadmap item" }),
    ).toBeVisible();
    await waitUntilSaved(page);
    const databases = () =>
      page.evaluate(async () =>
        (await indexedDB.databases()).map((d) => d.name ?? ""),
      );
    const owner = seeded.users[0]!.id;
    expect((await databases()).some((name) => name.includes(owner))).toBe(true);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    expect((await databases()).some((name) => name.includes(owner))).toBe(
      false,
    );

    await page.getByLabel("Email", { exact: true }).fill(other.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${other.slug}/`));
    await expect(page.getByText("Other Company").first()).toBeVisible();
    await expect(page.getByText("Sync SWAP")).toHaveCount(0);
    await expect(page.getByText("Confidential roadmap item")).toHaveCount(0);
    await page.goto(seeded.itemPath(1));
    await expect(
      page.getByRole("heading", { name: "This workspace was not found" }),
    ).toBeVisible();
    await expect(page.getByText("Confidential roadmap item")).toHaveCount(0);
    expect((await databases()).some((name) => name.includes(owner))).toBe(
      false,
    );
  } finally {
    await shared.context.close();
  }
});

test("a session ended on the server asks to sign in again, then work continues", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const seeded = await seed("AUTH");
  const workItemId = await seedItem(seeded, { title: "Tax reports" });
  const ben = await newPerson(browser, "192.0.2.169");
  try {
    await signIn(ben.page, seeded.users[1]!.email);
    await ben.page.goto(seeded.itemPath(1));
    await opened(ben.page, "Tax reports");
    await waitUntilSaved(ben.page);
    await withDb((db) =>
      db.delete(s.session).where(eq(s.session.userId, seeded.users[1]!.id)),
    );
    // The next change reaches the server without a session.
    await setPriority(ben.page, "High");
    const notice = ben.page
      .getByRole("alert")
      .filter({ hasText: "Your session expired or your access changed" });
    await expect(notice).toBeVisible({ timeout: 30_000 });
    expect(await priorityOf(workItemId)).toBe("none");
    // Leaving for the sign-in page keeps the unsent change once Zero has
    // stored it on the device (within about a second of the change).
    await waitUntilStoredLocally(ben.page, '"priority":"high"');
    await notice.getByRole("button", { name: "Sign in again" }).click();
    await expect(ben.page).toHaveURL(
      `/sign-in?callbackUrl=${encodeURIComponent(seeded.itemPath(1))}`,
    );
    await ben.page
      .getByLabel("Email", { exact: true })
      .fill(seeded.users[1]!.email);
    await ben.page.getByLabel("Password", { exact: true }).fill(password);
    await ben.page
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(ben.page).toHaveURL(seeded.itemPath(1));
    // The change made while signed out was kept and is now saved.
    await expect(
      properties(ben.page).getByRole("button", {
        name: "Priority: High",
        exact: true,
      }),
    ).toBeVisible();
    await waitUntilSaved(ben.page);
    await expect.poll(() => priorityOf(workItemId)).toBe("high");
    await expect(notice).toHaveCount(0);
  } finally {
    await ben.context.close();
  }
});
