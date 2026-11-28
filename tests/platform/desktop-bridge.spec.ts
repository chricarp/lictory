import { test, expect, type Page } from "@playwright/test";
import { clientAddress } from "../helpers/client-address";
import { currentRevision, seedWorkspace, signIn } from "../helpers/seed";

// The web app inside the desktop app (apps/desktop), with the desktop bridge
// replaced by a recorder: a notification that asks for the person's
// attention reaches the native notification, the shell can navigate the
// page, and the badge counts what waits on the person in the organization
// open in the window (the Inbox's To do, as the sidebar shows it), so it
// rises with a review request and clears when the request is gone. The
// shell's side is covered by apps/desktop/tests/smoke.spec.ts.

type Recorded = {
  notified: { title: string; body: string; path?: string; tag?: string }[];
  badges: number[];
  organizations: (string | null)[];
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
      organizations: [] as (string | null)[],
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
        setOrganizationName: (name: string | null) =>
          recorded.organizations.push(name),
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
    return {
      notified: r.notified,
      badges: r.badges,
      organizations: r.organizations,
    };
  });

test("@smoke an assignment reaches the desktop notification; the badge counts what waits on you", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const run = crypto.randomUUID().slice(0, 6);
  const seeded = await seedWorkspace({
    name: `Desktop ${run}`,
    key: "DSK",
    users: [`Owen Owner ${run}`, `Ana Assignee ${run}`],
    disciplines: { 1: "Engineering" },
  });
  const ana = seeded.users[1]!;
  await installBridge(page);
  await signIn(page, ana.email);
  await page.goto(`/${seeded.slug}/inbox`);

  // Nothing asks for Ana yet: the badge is cleared, nothing is shown.
  await expect.poll(async () => (await recorded(page)).badges.at(-1)).toBe(0);
  // Her only organization names the server in the app's switcher, once
  // (never the host first while memberships load).
  await expect
    .poll(async () => (await recorded(page)).organizations)
    .toEqual([`Desktop ${run}`]);

  // The owner assigns Ana a new story.
  const workItemId = crypto.randomUUID();
  await seeded.command({
    type: "createWorkItem",
    projectId: seeded.projectId,
    workItemId,
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
  // An assignment is news (Updates), not something waiting on her: the
  // badge shows the sidebar's number, which it does not change.
  expect((await recorded(page)).badges.at(-1)).toBe(0);

  // A notification click: the shell asks the page to open the item.
  await page.evaluate(
    (path) =>
      (
        window as unknown as { desktopRecorded: Recorded }
      ).desktopRecorded.navigate(path),
    `/${seeded.slug}/items/DSK-1`,
  );
  await expect(page).toHaveURL(new RegExp(`/${seeded.slug}/.*DSK-1`));

  // The owner asks for her review: it waits on her, so the badge counts it,
  // the same number as the Inbox in the sidebar.
  const revision = await currentRevision(workItemId);
  const reviewId = crypto.randomUUID();
  await seeded.command({
    type: "requestReview",
    workItemId,
    baseRevisionId: revision.id,
    reviewId,
    disciplineId: seeded.roster.disciplines.find(
      (d) => d.projectId === seeded.projectId && d.name === "Engineering",
    )!.id,
    userId: ana.id,
    required: true,
  });
  await expect
    .poll(async () => (await recorded(page)).badges.at(-1), {
      timeout: 45_000,
    })
    .toBe(1);
  await expect(
    page
      .getByRole("navigation", { name: "Workspace", exact: true })
      .getByRole("link", { name: "Inbox", exact: true }),
  ).toHaveAccessibleDescription(/1 to do/);

  // Reading notifications does not answer it; the request going away does.
  await page.goto(`/${seeded.slug}/inbox?view=updates`);
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect.poll(async () => (await recorded(page)).badges.at(-1)).toBe(1);
  await seeded.command({ type: "cancelReview", workItemId, reviewId });
  await expect
    .poll(async () => (await recorded(page)).badges.at(-1), {
      timeout: 45_000,
    })
    .toBe(0);
  // Nothing is notified twice.
  expect((await recorded(page)).notified).toHaveLength(0);
});
