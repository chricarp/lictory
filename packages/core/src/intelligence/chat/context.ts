import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Database } from "@lictory/core/domain/service";
import { commitVersions } from "@lictory/core/knowledge/search";
import { pageAccess } from "@lictory/core/spaces/access";
import {
  pageContextKey,
  type ChatMessage,
  type PageContext,
  type VerifiedPage,
} from "@lictory/core/intelligence/chat/shared";

// The page contexts of a conversation, checked against what the person may
// read when the turn runs (not when the message was sent): a context names
// a page, it never grants access. A page they cannot read now, a commit or
// branch that is not the page's, or a page moved to another space resolves
// to null, and the prompt then withholds it and any text quoted from it.
export async function verifyPageContexts(
  db: Database,
  actor: { organizationId: string; userId: string },
  messages: readonly ChatMessage[],
): Promise<Map<string, VerifiedPage | null>> {
  const contexts = new Map<string, PageContext>();
  for (const message of messages)
    for (const part of message.parts)
      if (part.type === "data-context" && part.data.document?.kind === "page")
        contexts.set(pageContextKey(part.data.document), part.data.document);
  const out = new Map<string, VerifiedPage | null>();
  if (!contexts.size) return out;
  await db.transaction(
    async (tx) => {
      for (const [key, context] of contexts)
        out.set(key, await verify(tx, actor, context));
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return out;
}

async function verify(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  actor: { organizationId: string; userId: string },
  context: PageContext,
): Promise<VerifiedPage | null> {
  const org = actor.organizationId;
  const found = await pageAccess(tx, actor, context.pageId);
  if (!found?.level || found.space.id !== context.spaceId) return null;
  const branches = await tx
    .select({
      id: s.pageBranch.id,
      name: s.pageBranch.name,
      isMain: s.pageBranch.isMain,
      headCommitId: s.pageBranch.headCommitId,
      deletedAt: s.pageBranch.deletedAt,
    })
    .from(s.pageBranch)
    .where(
      and(
        eq(s.pageBranch.organizationId, org),
        eq(s.pageBranch.pageId, context.pageId),
      ),
    );
  const main = branches.find((b) => b.isMain);
  const branch = context.branchId
    ? branches.find((b) => b.id === context.branchId && !b.deletedAt)
    : main;
  if (!main || !branch) return null;
  const commitId = context.commitId ?? branch.headCommitId;
  const [commit] = await tx
    .select({ id: s.pageCommit.id, title: s.pageCommit.title })
    .from(s.pageCommit)
    .where(
      and(
        eq(s.pageCommit.organizationId, org),
        eq(s.pageCommit.pageId, context.pageId),
        eq(s.pageCommit.id, commitId),
      ),
    );
  if (!commit) return null;
  const version = (await commitVersions(tx, org, [commit.id])).get(commit.id);
  return {
    pageId: found.page.id,
    spaceId: found.space.id,
    spaceName: found.space.name,
    publishing: found.space.publishing,
    title: commit.title,
    commitId: commit.id,
    version: version ?? 1,
    published: commit.id === main.headCommitId,
    branchName: branch.isMain ? null : branch.name,
    archived: (found.page.archivedAt ?? found.space.archivedAt) !== null,
  };
}
