import { expect, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { withDb, type Seeded } from "./seed";

// Pages of Lictory Spaces for browser workflows about knowledge and work,
// written through the domain like the rest of the seed.

type Node = Record<string, unknown>;
export const text = (value: string): Node => ({ type: "text", text: value });
export const paragraph = (id: string, ...content: Node[]): Node => ({
  type: "paragraph",
  attrs: { id },
  content,
});
export const itemRef = (workItemId: string, key: string): Node => ({
  type: "workItemRef",
  attrs: { workItemId, key },
});
export const doc = (...content: Node[]) =>
  ({ type: "doc", content }) as unknown as Record<string, never>;

export async function createSpace(
  seeded: Seeded,
  name: string,
  extra: Record<string, unknown> = {},
  actor?: string,
) {
  const spaceId = crypto.randomUUID();
  const slug = `${name.toLowerCase().replaceAll(/[^a-z]+/g, "-")}-${spaceId.slice(0, 6)}`;
  await seeded.command(
    {
      type: "createSpace",
      spaceId,
      name,
      slug,
      home: { projectId: seeded.projectId },
      ...extra,
    },
    actor,
  );
  return { spaceId, slug };
}

// Creates a page (its first published version) and returns that version.
export async function createPage(
  seeded: Seeded,
  space: { spaceId: string; slug: string },
  title: string,
  content: Node[],
  actor?: string,
) {
  const pageId = crypto.randomUUID();
  await seeded.command(
    {
      type: "createPage",
      spaceId: space.spaceId,
      pageId,
      title,
      content: doc(...content),
    },
    actor,
  );
  return {
    pageId,
    commitId: await publishedCommit(pageId),
    url: `/${seeded.slug}/spaces/${space.slug}/pages/${pageId}`,
  };
}

export const publishedCommit = (pageId: string) =>
  withDb(async (db) => {
    const [row] = await db
      .select({ head: s.pageBranch.headCommitId })
      .from(s.pageBranch)
      .where(
        and(eq(s.pageBranch.pageId, pageId), eq(s.pageBranch.isMain, true)),
      );
    return row!.head;
  });

export const itemByTitle = (seeded: Seeded, title: string) =>
  withDb(async (db) => {
    const [row] = await db
      .select({ id: s.workItem.id, number: s.workItem.number })
      .from(s.workItem)
      .where(
        and(
          eq(s.workItem.organizationId, seeded.organizationId),
          eq(s.workItem.title, title),
        ),
      );
    return row!;
  });

// Any capability, as the person signed in on `page` (the browser's own route).
export async function capability<T = Record<string, unknown>>(
  page: Page,
  organizationId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await page.request.post(`/api/capabilities/${name}`, {
    headers: { origin: new URL(page.url()).origin },
    data: { organizationId, ...input },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as T;
}

// Selects text in the page reader, as a person dragging over it would.
export async function selectPageText(page: Page, wanted: string) {
  await page.evaluate((value) => {
    const root = document.querySelector(".page-document");
    if (!root) throw new Error("No page content");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(value) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + value.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`"${value}" is not in the page`);
  }, wanted);
}

export const knowledgeSection = (page: Page) =>
  page.getByRole("region", { name: "Knowledge", exact: true });
