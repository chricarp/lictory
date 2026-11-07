import { test, expect, type Page } from "@playwright/test";
import { clientAddress } from "../helpers/client-address";
import {
  capability,
  createPage,
  createSpace,
  itemByTitle,
  itemRef,
  knowledgeSection,
  paragraph,
  selectPageText,
  text,
} from "../helpers/knowledge";
import {
  newPerson,
  seedItem,
  seedWorkspace,
  signIn,
  type Seeded,
} from "../helpers/seed";

// Lictory Intelligence on pages of Lictory Spaces, against the browser
// suite's scripted AI provider (scripts/e2e-fakes/openai.ts, behind the AI
// SDK's real OpenAI adapter; scripts/test-e2e.ts runs *.ai.spec.ts files with
// it). The provider only decides which tool to call from the request; the
// tools run in the worker with the asking person's permissions, citations
// come from what they returned, and what the provider was sent is recorded so
// a test can prove a private page never reached it.
// See docs/internals/ai.md#evidence-and-citations and
// docs/operations/development.md#test-tiers.

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

async function workspace(name: string, key: string, ai = true) {
  const seeded = await seedWorkspace({
    name,
    key,
    users: ["Ada Owner", "Rhea Reader"],
  });
  if (ai) await seeded.command({ type: "setAiPolicy", enabled: true });
  return seeded;
}

const reader = (page: Page) => page.getByRole("document", { name: /content/ });
const dock = (page: Page) => page.getByRole("complementary", { name: "Litto" });

// ⌘J / Ctrl+J opens the dock once the workspace directory, which says whether
// Litto is available, has synchronized; the page's text can arrive before it,
// and a press before then does nothing. Press again only while the dock is
// still closed, so a press that already opened it is never undone.
async function openDockByShortcut(page: Page) {
  await expect(async () => {
    if ((await dock(page).count()) === 0)
      await page.keyboard.press("ControlOrMeta+j");
    await expect(dock(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

// What the scripted provider was sent, as raw request bodies.
async function providerRequests() {
  const response = await fetch(
    `${process.env.E2E_SCRIPTED_AI_URL}/__scripted-ai/requests`,
  );
  return (await response.json()) as { body: string }[];
}

async function ask(page: Page, seeded: Seeded, question: string) {
  await page.goto(`/${seeded.slug}/intelligence`);
  await page.getByRole("textbox", { name: "Message Litto" }).fill(question);
  await page.getByRole("button", { name: "Send message" }).click();
}

test("Litto lists the work items of the page version on screen and cites that exact version", async ({
  page,
}) => {
  const seeded = await workspace("Litto mentions", "LTM");
  const refunds = await seedItem(seeded, { title: "Refund approvals" });
  const evidence = await seedItem(seeded, { title: "Chargeback evidence" });
  const ops = await createSpace(seeded, "Operations");
  const runbook = await createPage(seeded, ops, "Refund runbook", [
    paragraph("p1", text("Approvals follow "), itemRef(refunds, "LTM-1")),
  ]);
  await signIn(page, seeded.owner.email);
  await page.goto(runbook.url);
  // Version 2 also mentions LTM-2.
  const head = await capability<{ commitId: string }>(
    page,
    seeded.organizationId,
    "getPage",
    { pageId: runbook.pageId },
  );
  const pullRequestId = crypto.randomUUID();
  const proposed = await capability<{ commitId: string }>(
    page,
    seeded.organizationId,
    "proposePageChange",
    {
      pageId: runbook.pageId,
      branchId: crypto.randomUUID(),
      pullRequestId,
      title: "Refund runbook",
      content: {
        type: "doc",
        content: [
          paragraph("p1", text("Approvals follow "), itemRef(refunds, "LTM-1")),
          paragraph("p2", text("Disputes follow "), itemRef(evidence, "LTM-2")),
        ],
      },
      message: "Mention chargebacks",
    },
  );
  await capability(page, seeded.organizationId, "mergePagePullRequest", {
    pullRequestId,
    inspectedSourceHead: proposed.commitId,
    inspectedTargetHead: head.commitId,
  });

  // Reading version 1, the person asks the dock's page question.
  await page.goto(`${runbook.url}?commit=${runbook.commitId}`);
  await expect(reader(page)).toContainText("Approvals follow");
  await expect(reader(page)).not.toContainText("Disputes follow");
  await selectPageText(page, "Approvals follow");
  await page
    .getByRole("group", { name: "Selected text" })
    .getByRole("button", { name: "Ask Litto" })
    .click();
  await dock(page)
    .getByRole("textbox", { name: "Message Litto" })
    .fill("Which work items does this page mention?");
  await dock(page).getByRole("button", { name: "Send message" }).click();

  // The answer rests on getPage of that version, run with Ada's access.
  await expect(dock(page)).toContainText(
    "Version 1 of “Refund runbook” mentions LTM-1.",
    { timeout: 45_000 },
  );
  await expect(dock(page)).not.toContainText("LTM-2");
  // Every citation (the step that read it, and the pages the answer rests
  // on) opens exactly version 1.
  const cited = dock(page)
    .getByRole("list", { name: "Pages used" })
    .getByRole("link");
  await expect(cited.first()).toContainText("Refund runbook");
  await expect(cited.first()).toContainText("version 1");
  const hrefs = await cited.evaluateAll((links) =>
    links.map((l) => l.getAttribute("href")),
  );
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs)
    expect(href).toMatch(
      new RegExp(`/pages/${runbook.pageId}\\?commit=${runbook.commitId}$`),
    );
});

test("drafted proposals from a page selection are chosen by the person and remember the page", async ({
  page,
}) => {
  const seeded = await workspace("Litto drafts", "LTD");
  const ops = await createSpace(seeded, "Operations");
  const policy = await createPage(seeded, ops, "Refund policy", [
    paragraph(
      "rule",
      text(
        "Refunds above 500 EUR need a second approver. Finance answers within one business day.",
      ),
    ),
  ]);
  await signIn(page, seeded.owner.email);
  await page.goto(policy.url);
  await expect(reader(page)).toContainText("second approver");
  await selectPageText(
    page,
    "Refunds above 500 EUR need a second approver. Finance answers within one business day.",
  );
  await page
    .getByRole("group", { name: "Selected text" })
    .getByRole("button", { name: "Create work item" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Draft with Litto" }).check();
  await dialog
    .getByRole("button", { name: "Draft proposals", exact: true })
    .click();

  // Two drafts, each citing its sentence; nothing is created yet.
  const drafts = dialog.getByRole("group", {
    name: "Choose the proposals to create",
  });
  await expect(drafts.getByRole("checkbox")).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(drafts).toContainText(
    "Refunds above 500 EUR need a second approver",
  );
  await drafts
    .getByRole("checkbox", { name: /Finance answers within one business day/ })
    .check();
  await dialog
    .getByRole("button", { name: "Create 1 proposal", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: /created$/ })
    .getByRole("button", { name: "Done" })
    .click();

  // Only the chosen draft became a proposal, and it remembers its source.
  const created = await itemByTitle(
    seeded,
    "Finance answers within one business day",
  );
  expect(
    await itemByTitle(seeded, "Refunds above 500 EUR need a second approver"),
  ).toBeUndefined();
  await page.goto(seeded.itemPath(created.number));
  const knowledge = knowledgeSection(page);
  await expect(knowledge).toContainText("Created from");
  await expect(knowledge).toContainText("Refund policy");
  await expect(knowledge).toContainText(
    "Finance answers within one business day",
  );
});

test("a page the person cannot read never reaches Litto's answer, its citations or the provider", async ({
  browser,
}) => {
  const seeded = await workspace("Litto private", "LTP");
  const people = await createSpace(seeded, "People ops", {
    accessMode: "restricted",
  });
  await createPage(seeded, people, "Compensation bands", [
    paragraph(
      "bonus",
      text("The retention bonus formula is two months of salary."),
    ),
  ]);
  const question = 'What do our pages say about "retention bonus formula"?';
  const ada = await newPerson(browser);
  const rhea = await newPerson(browser);
  try {
    // Ada reads the space: the same question finds and cites the page.
    await signIn(ada.page, seeded.owner.email);
    await ask(ada.page, seeded, question);
    await expect(
      ada.page.getByText(
        "Version 1 of “Compensation bands” says: “The retention bonus formula is two months of salary.”",
      ),
    ).toBeVisible({ timeout: 45_000 });
    await expect(
      ada.page.getByRole("list", { name: "Pages used" }).first(),
    ).toContainText("Compensation bands");

    // Rhea cannot: her search and answer come back empty-handed.
    await signIn(rhea.page, seeded.users[1]!.email);
    await ask(rhea.page, seeded, question);
    await expect(
      rhea.page.getByText(
        "Nothing you can read mentions “retention bonus formula”: no page, decision or agreement matched.",
      ),
    ).toBeVisible({ timeout: 45_000 });
    await expect(
      rhea.page.getByRole("list", { name: "Pages used" }),
    ).toHaveCount(0);
    const shown = await rhea.page.content();
    for (const secret of [
      "Compensation bands",
      "two months of salary",
      "People ops",
    ])
      expect(shown).not.toContain(secret);

    // Nothing about the page was sent to the provider for Rhea either.
    const sent = (await providerRequests())
      .map((r) => r.body)
      .filter(
        (body) => body.includes(seeded.slug) && body.includes("Rhea Reader"),
      );
    expect(sent.length).toBeGreaterThan(0);
    for (const body of sent)
      for (const secret of [
        "Compensation bands",
        "two months of salary",
        "People ops",
      ])
        expect(body).not.toContain(secret);
  } finally {
    await Promise.all([ada.context.close(), rhea.context.close()]);
  }
});

test("a page whose access is withdrawn mid-conversation stays out of the next answer and what the provider is sent", async ({
  browser,
}) => {
  const seeded = await workspace("Litto revoked", "LTR");
  const payout = await seedItem(seeded, { title: "Retention payout" });
  const people = await createSpace(seeded, "People ops", {
    accessMode: "restricted",
  });
  const bands = await createPage(seeded, people, "Compensation bands", [
    paragraph(
      "bonus",
      text("The retention bonus formula is two months of salary. Paid by "),
      itemRef(payout, "LTR-1"),
    ),
  ]);
  const rhea = seeded.users[1]!;
  const grant = (level: "view" | null) =>
    seeded.command({
      type: "setSpaceGrant",
      spaceId: people.spaceId,
      userId: rhea.id,
      level,
    });
  const secrets = ["Compensation bands", "two months of salary", "People ops"];
  await grant("view");
  const { page, context } = await newPerson(browser);
  try {
    // Rhea reads the page and asks Litto about it from the dock.
    await signIn(page, rhea.email);
    await page.goto(bands.url);
    await expect(reader(page)).toContainText("retention bonus formula");
    await reader(page).click();
    await openDockByShortcut(page);
    const litto = dock(page);
    const question = "Which work items does this page mention?";
    const composer = litto.getByRole("textbox", { name: "Message Litto" });
    await composer.fill(question);
    await litto.getByRole("button", { name: "Send message" }).click();
    await expect(litto).toContainText(
      "Version 1 of “Compensation bands” mentions LTR-1.",
      { timeout: 45_000 },
    );
    // How often the dock shows anything of the page.
    const mentions = async () => {
      const shown = await litto.innerText();
      return secrets.reduce((n, s) => n + shown.split(s).length - 1, 0);
    };
    const before = await mentions();
    expect(before).toBeGreaterThan(0);
    const citations = litto.getByRole("list", { name: "Pages used" });
    const cited = await citations.count();
    const sentBefore = (await providerRequests()).length;

    // Her access is withdrawn while the page and the conversation are open.
    await grant(null);
    await expect(reader(page)).toHaveCount(0, { timeout: 20_000 });
    // What the next message carries no longer names the page.
    const carried = litto.locator('[title="Sent with your next message"]');
    await expect(carried).toBeVisible();
    for (const secret of secrets)
      await expect(carried).not.toContainText(secret);

    await composer.fill(question);
    await litto.getByRole("button", { name: "Send message" }).click();
    await expect(litto).toContainText(
      /Open a page first\.|I cannot read that page/,
      { timeout: 45_000 },
    );
    // The new answer adds no title, quote or citation of the page (the
    // earlier answer stays in her own transcript).
    expect(await mentions()).toBeLessThanOrEqual(before);
    expect(await citations.count()).toBeLessThanOrEqual(cited);

    // Nor was any of it sent to the provider for the new question: not the
    // page context, not the earlier getPage result, not the earlier answer.
    const sent = (await providerRequests())
      .slice(sentBefore)
      .map((r) => r.body)
      .filter(
        (body) => body.includes(seeded.slug) && body.includes("Rhea Reader"),
      );
    expect(sent.length).toBeGreaterThan(0);
    for (const body of sent)
      for (const secret of [...secrets, "retention bonus formula"])
        expect(body).not.toContain(secret);
  } finally {
    await context.close();
  }
});

test("with Lictory Intelligence turned off, pages offer no AI controls and work is still created by hand", async ({
  page,
}) => {
  const seeded = await workspace("Litto off", "LTO");
  const ops = await createSpace(seeded, "Operations");
  const policy = await createPage(seeded, ops, "Refund policy", [
    paragraph("rule", text("Refunds above 500 EUR need a second approver.")),
  ]);
  await signIn(page, seeded.owner.email);

  // Turned on, the page offers Litto.
  await page.goto(policy.url);
  await expect(reader(page)).toContainText("second approver");
  await reader(page).click();
  await openDockByShortcut(page);
  await dock(page).getByRole("button", { name: "Close Litto" }).click();
  await expect(dock(page)).toHaveCount(0);
  await selectPageText(page, "need a second approver");
  const toolbar = page.getByRole("group", { name: "Selected text" });
  await expect(
    toolbar.getByRole("button", { name: "Ask Litto" }),
  ).toBeVisible();

  // An administrator turns Lictory Intelligence off.
  await page.goto(`/${seeded.slug}/settings/intelligence`);
  const allow = page.getByRole("switch", {
    name: "Allow Lictory Intelligence",
  });
  await expect(allow).toHaveAttribute("aria-checked", "true");
  await allow.click();
  await expect(allow).toHaveAttribute("aria-checked", "false");

  await page.goto(policy.url);
  await expect(reader(page)).toContainText("second approver");
  await reader(page).click();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(dock(page)).toHaveCount(0);
  await selectPageText(page, "need a second approver");
  await expect(toolbar.getByRole("button", { name: "Comment" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Ask Litto" })).toHaveCount(
    0,
  );
  await toolbar.getByRole("button", { name: "Create work item" }).click();
  const dialog = page.getByRole("dialog", { name: "Create work item" });
  await expect(
    dialog.getByRole("radio", { name: "Draft with Litto" }),
  ).toHaveCount(0);
  await dialog
    .getByRole("textbox", { name: "Title" })
    .fill("Second approver for large refunds");
  await dialog.getByRole("button", { name: "Create work item" }).click();
  await page
    .getByRole("dialog", { name: /created$/ })
    .getByRole("button", { name: "Done" })
    .click();
  const created = await itemByTitle(
    seeded,
    "Second approver for large refunds",
  );
  await page.goto(seeded.itemPath(created.number));
  await expect(knowledgeSection(page)).toContainText("Created from");
  await expect(knowledgeSection(page)).toContainText("need a second approver");
  await page.goto(`/${seeded.slug}/intelligence`);
  await expect(page.getByText("Litto is turned off")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Litto" }),
  ).toHaveCount(0);
});
