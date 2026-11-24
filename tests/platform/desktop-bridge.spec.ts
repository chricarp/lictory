import { test, expect, type Page } from "@playwright/test";
import { clientAddress } from "../helpers/client-address";
import { seedWorkspace, signIn } from "../helpers/seed";

// The web app inside the desktop app (apps/desktop), with the desktop bridge
// replaced by a recorder: a notification that asks for the person's
// attention reaches the native notification and the badge, the shell can
// navigate the page, and reading it in the inbox clears the badge. The
// shell's side is covered by apps/desktop/tests/smoke.spec.ts.

type Recorded = {
  notified: { title: string; body: string; path?: string; tag?: string }[];
  badges: number[];
  navigate: (path: string) => void;
};

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

async function installBridge(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Set<(path: string) => void>();
    const recorded = {
      notified: [] as unknown[],
      badges: [] as number[],
      navigate: (path: string) => {
        for (const listener of listeners) listener(path);
      },
    };
    Object.assign(window, {
      desktopRecorded: recorded,
      lictoryDesktop: {
        platform: "linux",
        version: "0.0.0-test",
        notify: (notification: unknown) => recorded.notified.push(notification),
        setBadge: (count: number) => recorded.badges.push(count),
        onNavigate: (listener: (path: string) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    });
  });
}

const recorded = (page: Page) =>
  page.evaluate(() => {
    const r = (window as unknown as { desktopRecorded: Recorded })
      .desktopRecorded;
    return { notified: r.notified, badges: r.badges };
  });

test("@smoke an assignment reaches the desktop notification and badge", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const run = crypto.randomUUID().slice(0, 6);
  const seeded = await seedWorkspace({
    name: `Desktop ${run}`,
    key: "DSK",
    users: [`Owen Owner ${run}`, `Ana Assignee ${run}`],
  });
  const ana = seeded.users[1]!;
  await installBridge(page);
  await signIn(page, ana.email);
  await page.goto(`/${seeded.slug}/inbox`);

  // Nothing asks for Ana yet: the badge is cleared, nothing is shown.
  await expect.poll(async () => (await recorded(page)).badges.at(-1)).toBe(0);

  // The owner assigns Ana a new story.
  await seeded.command({
    type: "createWorkItem",
    projectId: seeded.projectId,
    workItemId: crypto.randomUUID(),
    typeId: seeded.typeId("Story"),
    parentId: null,
    title: "Retry failed payments",
    assigneeId: ana.id,
  });

  await expect
    .poll(async () => (await recorded(page)).notified, { timeout: 45_000 })
    .toEqual([
      {
        title: `Owen Owner ${run} assigned DSK-1 to you`,
        body: "Retry failed payments",
        path: `/${seeded.slug}/items/DSK-1`,
        tag: expect.any(String) as unknown as string,
      },
    ]);
  expect((await recorded(page)).badges.at(-1)).toBe(1);

  // A notification click: the shell asks the page to open the item.
  await page.evaluate(
    (path) =>
      (
        window as unknown as { desktopRecorded: Recorded }
      ).desktopRecorded.navigate(path),
    `/${seeded.slug}/items/DSK-1`,
  );
  await expect(page).toHaveURL(new RegExp(`/${seeded.slug}/.*DSK-1`));

  // Reading it in the inbox clears the badge; nothing is notified twice.
  await page.goto(`/${seeded.slug}/inbox?view=updates`);
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect.poll(async () => (await recorded(page)).badges.at(-1)).toBe(0);
  expect((await recorded(page)).notified).toHaveLength(0);
});
