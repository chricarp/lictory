import { test, expect, type Page } from "@playwright/test";
import { clientAddress } from "../helpers/client-address";
import {
  currentRevision,
  seedItem,
  seedWorkspace,
  signIn,
} from "../helpers/seed";

// Content search from the command palette: a phrase written only in the
// body of a published page is found on the server (searchKnowledge), shown
// with the matched words marked, and opens the page at the block that
// matched. Drafts and branches are never searched (domain tests).

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  return palette;
}

test("a phrase only in a page body is found from the palette and opens the page at the block", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Refunds",
    key: "REF",
    users: ["Rita Reader"],
  });
  const spaceId = crypto.randomUUID();
  const slug = `ops-${spaceId.slice(0, 8)}`;
  await seeded.command({
    type: "createSpace",
    spaceId,
    name: "Operations",
    slug,
  });
  const created = await seeded.command({
    type: "createPage",
    spaceId,
    pageId: crypto.randomUUID(),
    title: "Refund handling",
  });
  const { pageId, commitId } = created.summary as {
    pageId: string;
    commitId: string;
  };
  // Long enough that the matched block starts below the fold.
  const filler = Array.from({ length: 30 }, (_, i) => ({
    type: "paragraph",
    attrs: { id: `filler-${i}` },
    content: [{ type: "text", text: `Background note ${i + 1}.` }],
  }));
  const proposal = (
    await seeded.command({
      type: "proposePageChange",
      pageId,
      branchId: crypto.randomUUID(),
      pullRequestId: crypto.randomUUID(),
      title: "Refund handling",
      content: {
        type: "doc",
        content: [
          ...filler,
          {
            type: "paragraph",
            attrs: { id: "refund-rule" },
            content: [
              {
                type: "text",
                text: "Refunds above 500 EUR need a second approver from finance.",
              },
            ],
          },
        ],
      },
      message: "Write the refund rule",
    })
  ).summary as { pullRequestId: string; commitId: string };
  await seeded.command({
    type: "mergePagePullRequest",
    pullRequestId: proposal.pullRequestId,
    inspectedSourceHead: proposal.commitId,
    inspectedTargetHead: commitId,
  });

  await signIn(page, seeded.owner.email);
  await page.goto(`/${seeded.slug}/spaces`);
  await expect(
    page.getByRole("link", { name: /Operations/ }).first(),
  ).toBeVisible();

  const palette = await openPalette(page);
  await palette
    .getByRole("textbox", { name: "Search" })
    .fill("second approver");
  // The title does not match: the result comes from the page's content,
  // with the version it was found in and the matched words marked.
  const result = palette.getByRole("option", { name: /Refund handling/ });
  await expect(result).toBeVisible();
  await expect(palette.getByText("In pages", { exact: true })).toBeVisible();
  await expect(result).toContainText("Operations · v2");
  await expect(result.locator("mark")).toHaveText("second approver");
  await expect(palette.getByRole("status")).toContainText("1 content match");

  // Keyboard: the content result is the first option; Enter opens it.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    new RegExp(`/spaces/${slug}/pages/${pageId}#block-refund-rule$`),
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Refund handling" }),
  ).toBeVisible();
  await expect(page.locator('[data-id="refund-rule"]')).toBeInViewport();

  // Nothing matches: the palette says so for the content as well.
  const again = await openPalette(page);
  await again.getByRole("textbox", { name: "Search" }).fill("zebra crossing");
  await expect(again.getByRole("status")).toContainText(
    "No matches in pages, specifications or decisions",
  );
  await page.keyboard.press("Escape");

  // Phone width: the result and its excerpt fit without scrolling sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const phone = page.getByRole("dialog", { name: "Command palette" });
  await phone.getByRole("textbox", { name: "Search" }).fill("second approver");
  await expect(
    phone.getByRole("option", { name: /Refund handling/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("See all results lists every match a batch at a time, by kind, and forgets them with access", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedWorkspace({
    name: "Kumquats",
    key: "KUM",
    users: ["Rita Owner", "Sam Member"],
  });
  const space = async (name: string, accessMode?: "restricted") => {
    const spaceId = crypto.randomUUID();
    await seeded.command({
      type: "createSpace",
      spaceId,
      name,
      slug: `${name.toLowerCase()}-${spaceId.slice(0, 6)}`,
      ...(accessMode ? { accessMode } : {}),
    });
    return spaceId;
  };
  const handbook = await space("Handbook");
  const operations = await space("Operations");
  const secret = await space("Secrets", "restricted");
  const pageWith = (spaceId: string, title: string, words: string) =>
    seeded.command({
      type: "createPage",
      spaceId,
      pageId: crypto.randomUUID(),
      title,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: crypto.randomUUID() },
            content: [{ type: "text", text: words }],
          },
        ],
      } as unknown as Record<string, never>,
    });
  // More pages than one batch, two with the same title.
  for (let i = 0; i < 22; i++)
    await pageWith(handbook, `Runbook ${i}`, `Kumquat handling step ${i}.`);
  await pageWith(operations, "Runbook 0", "Kumquat handling elsewhere.");
  await pageWith(secret, "Secret kumquat", "Kumquat incident.");
  await seeded.command({
    type: "setSpaceGrant",
    spaceId: secret,
    userId: seeded.users[1]!.id,
    level: "view",
  });

  await signIn(page, seeded.users[1]!.email);
  await page.goto(`/${seeded.slug}/spaces`);
  await expect(
    page.getByRole("link", { name: /Handbook/ }).first(),
  ).toBeVisible();
  const palette = await openPalette(page);
  await palette.getByRole("textbox", { name: "Search" }).fill("kumquat");
  await palette
    .getByRole("option", { name: /See all results for “kumquat”/ })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/${seeded.slug}/search\\?q=kumquat`),
  );
  const results = page.getByRole("list", { name: "Results for “kumquat”" });
  await expect(results.getByRole("listitem")).toHaveCount(20);
  await page.getByRole("button", { name: "Show more results" }).click();
  await expect(results.getByRole("listitem")).toHaveCount(24);
  await expect(
    page.getByRole("button", { name: "Show more results" }),
  ).toHaveCount(0);
  // The same title twice, told apart by its space.
  const twins = results.getByRole("listitem").filter({
    has: page.getByRole("link", { name: "Runbook 0", exact: true }),
  });
  await expect(twins).toHaveCount(2);
  await expect(twins.filter({ hasText: "Operations" })).toHaveCount(1);
  // A kind filter narrows to decisions (none here), and back.
  await page.getByRole("radio", { name: "Decisions" }).click();
  await expect(page).toHaveURL(/kind=decisions/);
  await expect(page.getByText("No matches for “kumquat”")).toBeVisible();
  await page.getByRole("radio", { name: "Pages" }).click();
  await expect(results.getByRole("listitem")).toHaveCount(20);
  await expect(results).toContainText("Secret kumquat");

  // Every batch loaded, and the palette open over the results with the
  // restricted page among its answers.
  await page.getByRole("button", { name: "Show more results" }).click();
  await expect(results.getByRole("listitem")).toHaveCount(24);
  const open = await openPalette(page);
  await open.getByRole("textbox", { name: "Search" }).fill("kumquat");
  const secretOption = open.getByRole("option", { name: /Secret kumquat/ });
  await expect(secretOption).toBeVisible();

  // Losing access to the restricted space while both are open: the page
  // leaves the palette and every loaded batch of the results, without a
  // reload or another query.
  await seeded.command({
    type: "setSpaceGrant",
    spaceId: secret,
    userId: seeded.users[1]!.id,
    level: null,
  });
  await expect(secretOption).toHaveCount(0);
  await expect(open.getByRole("textbox", { name: "Search" })).toHaveValue(
    "kumquat",
  );
  await page.keyboard.press("Escape");
  await expect(results.getByRole("listitem")).toHaveCount(23);
  await expect(results).not.toContainText("Secret kumquat");
  // The server agrees: the batches read again offer nothing more.
  await expect(
    page.getByRole("button", { name: "Show more results" }),
  ).toHaveCount(0);
});

test("a delivered revision found by search opens that revision after the specification moved on", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Ledgers",
    key: "LED",
    users: ["Lena Owner"],
  });
  const workItemId = await seedItem(seeded, {
    title: "Retry ledger",
    description: "Retries write a new entry.",
  });
  const edit = async (content: string) => {
    const base = await currentRevision(workItemId);
    await seeded.command({
      type: "updateSpecification",
      workItemId,
      baseRevisionId: base.id,
      title: "Retry ledger",
      content,
    });
    return currentRevision(workItemId);
  };
  // Revision 2 is delivered; revisions 3 and 4 change the behavior.
  const delivered = await edit("Retries reuse the quince ledger entry.");
  await seeded.command({
    type: "acceptDeliveryScope",
    workItemId,
    baseRevisionId: delivered.id,
  });
  await seeded.command({
    type: "updateWorkItem",
    workItemId,
    statusId: seeded.roster.statuses.find(
      (x) => x.projectId === seeded.projectId && x.category === "done",
    )!.id,
  });
  await edit("Retries write a new ledger entry.");
  expect((await edit("Retries write a new entry per attempt.")).number).toBe(4);

  await signIn(page, seeded.owner.email);
  await page.goto(`/${seeded.slug}/search?q=quince+ledger`);
  const results = page.getByRole("list", {
    name: "Results for “quince ledger”",
  });
  const hit = results
    .getByRole("listitem")
    .filter({ hasText: "Delivered · revision 2" });
  await expect(hit).toHaveCount(1);
  // The item as it is now is a separate, explicit way in.
  await expect(
    hit.getByRole("link", { name: "Open LED-1 as it is now" }),
  ).toHaveAttribute("href", seeded.itemPath(1));
  await hit.getByRole("link", { name: "Retry ledger" }).click();
  await expect(page).toHaveURL(
    new RegExp(`[?&]history=${delivered.id}&compare=none`),
  );
  await expect(page.getByRole("heading", { name: /Revision 2/ })).toBeVisible();
  await expect(
    page.getByText("Retries reuse the quince ledger entry."),
  ).toBeVisible();
});
