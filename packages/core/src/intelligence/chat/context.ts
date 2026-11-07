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

// Earlier turns are sent to the model again with every turn: their tool
// results (a page read with getPage, a page found by search) and the answers
// built on them. When the person can no longer read a page those name, the
// model must not get it back from the transcript either: the tool's input
// and result are replaced by a note, and so are the words of an earlier
// answer that used them or that was asked from that page. The stored
// transcript is unchanged (it is the person's own record); only what the
// model is sent is withheld.
export const WITHHELD_RESULT =
  "Withheld: this read a page the person cannot read now. Do not use or repeat anything from it.";
export const WITHHELD_ANSWER =
  "[An earlier answer drawn from a page the person cannot read now; withheld. Do not repeat anything from it.]";
// More distinct pages than this in one conversation are not checked one by
// one; the rest count as unreadable.
const MAX_CHECKED_PAGES = 200;

function pagesNamedIn(value: unknown, into: Set<string>, depth = 0) {
  if (depth > 12 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) pagesNamedIn(v, into, depth + 1);
    return;
  }
  for (const [key, v] of Object.entries(value)) {
    if (key === "pageId" && typeof v === "string" && v.length <= 100)
      into.add(v);
    else pagesNamedIn(v, into, depth + 1);
  }
}

type Part = ChatMessage["parts"][number];
const toolPart = (part: Part) =>
  part.type.startsWith("tool-") || part.type === "dynamic-tool"
    ? (part as { input?: unknown; output?: unknown; state?: string })
    : null;
const pagesOfTool = (part: Part) => {
  const ids = new Set<string>();
  const tool = toolPart(part);
  if (tool) {
    pagesNamedIn(tool.input, ids);
    pagesNamedIn(tool.output, ids);
  }
  return ids;
};

export async function withholdUnreadablePages(
  db: Database,
  actor: { organizationId: string; userId: string },
  messages: readonly ChatMessage[],
  contexts: ReadonlyMap<string, VerifiedPage | null>,
): Promise<ChatMessage[]> {
  const named = new Set(
    messages.flatMap((m) => m.parts.flatMap((p) => [...pagesOfTool(p)])),
  );
  const unreadable = new Set<string>();
  if (named.size)
    await db.transaction(
      async (tx) => {
        let checked = 0;
        for (const pageId of named) {
          if (checked++ >= MAX_CHECKED_PAGES) unreadable.add(pageId);
          else if (!(await pageAccess(tx, actor, pageId))?.level)
            unreadable.add(pageId);
        }
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  const namesUnreadable = (part: Part) =>
    [...pagesOfTool(part)].some((id) => unreadable.has(id));
  const askedFromUnreadable = (message: ChatMessage) =>
    message.parts.some(
      (p) =>
        p.type === "data-context" &&
        p.data.document?.kind === "page" &&
        !contexts.get(pageContextKey(p.data.document)),
    );
  // The words of the turn being answered are left as they are: they were
  // written with the person's access as it is now.
  const current = messages.findLastIndex((m) => m.role === "user");
  let fromUnreadable = false;
  return messages.map((message, index) => {
    if (message.role === "user") {
      fromUnreadable = askedFromUnreadable(message);
      return message;
    }
    const usedUnreadable = message.parts.some(namesUnreadable);
    const withholdWords = index < current && (fromUnreadable || usedUnreadable);
    if (!usedUnreadable && !withholdWords) return message;
    let said = false;
    const parts = message.parts.flatMap((part): Part[] => {
      if (namesUnreadable(part)) {
        const { state, output } = toolPart(part)!;
        // A refusal (the page was already unreadable) carries no content
        // and keeps its own words; a result is replaced.
        const refused =
          state === "output-error" ||
          (output as { ok?: unknown } | undefined)?.ok === false;
        return [
          {
            ...part,
            input: {},
            ...(state === "output-available" && !refused
              ? { output: { ok: false, error: { message: WITHHELD_RESULT } } }
              : {}),
          } as Part,
        ];
      }
      if (
        withholdWords &&
        (part.type === "text" || part.type === "reasoning")
      ) {
        if (said) return [];
        said = true;
        return [{ type: "text", text: WITHHELD_ANSWER }];
      }
      return [part];
    });
    return { ...message, parts };
  });
}
