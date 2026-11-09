import { test, expect } from "@playwright/test";
import { seedWorkspace, signIn } from "../helpers/seed";

test("page branch dropdowns preserve empty choices and keyboard selection", async ({
  page,
}, testInfo) => {
  const seeded = await seedWorkspace({
    name: "Dropdown review",
    key: "DROP",
    users: ["Dropdown Author"],
  });
  await signIn(page, seeded.owner.email);
  const spaceId = crypto.randomUUID(),
    pageId = crypto.randomUUID();
  for (const [name, input] of [
    [
      "createSpace",
      {
        spaceId,
        name: "Team handbook",
        slug: `dropdown-${pageId.slice(0, 8)}`,
        publishing: "reviewed",
      },
    ],
    ["createPage", { spaceId, pageId, title: "Recovery guidelines" }],
  ] as const) {
    const response = await page.request.post(`/api/capabilities/${name}`, {
      headers: { origin: new URL(page.url()).origin },
      data: { organizationId: seeded.organizationId, ...input },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const url = `/${seeded.slug}/spaces/dropdown-${pageId.slice(0, 8)}/pages/${pageId}`;
  await page.goto(`${url}/history?view=branches`);
  const start = page.getByRole("combobox", { name: "Start from" });
  await expect(start).toHaveText("Current main version");
  await start.click();
  await expect(
    page.getByRole("option", { name: "Current main version" }),
  ).toHaveAttribute("aria-selected", "true");
  await testInfo.attach("branch-start-dropdown", {
    path: await page
      .screenshot({ path: testInfo.outputPath("branch-start.png") })
      .then(() => testInfo.outputPath("branch-start.png")),
    contentType: "image/png",
  });
  await page.keyboard.press("Escape");
  await expect(start).toBeFocused();
  await page.getByLabel("Branch name").fill("clarify-recovery");
  await page
    .getByRole("button", { name: "Create branch", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "clarify-recovery", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Select clarify-recovery", exact: true })
    .click();
  await expect(page).toHaveURL(/[?&]branch=/);
  const branch = new URL(page.url()).searchParams.get("branch")!;
  await page.goto(`${url}?branch=${branch}`);
  const editor = page.locator('.page-document[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.fill("Retry failed requests safely.");
  await expect(
    page.getByTestId("draft-save-state").filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Commit to this branch" })
    .getByRole("button", { name: "Commit now" })
    .click();
  await expect(page.getByText("Committed version 2")).toBeVisible();
  await page.goto(`${url}/history?view=pulls`);
  const source = page.getByRole("combobox", { name: "Source branch" });
  await source.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("option", { name: "clarify-recovery", exact: true }),
  ).toBeVisible();
  await testInfo.attach("source-branch-dropdown", {
    path: await page
      .screenshot({ path: testInfo.outputPath("source-branch.png") })
      .then(() => testInfo.outputPath("source-branch.png")),
    contentType: "image/png",
  });
  await page.keyboard.press("End");
  await expect(
    page.getByRole("option", { name: "clarify-recovery", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(source).toHaveText("clarify-recovery");
  const target = page.getByRole("combobox", { name: "Target branch" });
  await target.click();
  await page.getByRole("option", { name: "main", exact: true }).click();
  await expect(target).toHaveText("main");
  await page
    .getByLabel("Title", { exact: true })
    .fill("Clarify recovery guidelines");
  await page
    .getByRole("button", { name: "Create pull request", exact: true })
    .click();
  await expect(page).toHaveURL(/[?&]pr=/);
  await page.reload();
  await expect(
    page.getByText("Clarify recovery guidelines", { exact: true }).first(),
  ).toBeVisible();
});
