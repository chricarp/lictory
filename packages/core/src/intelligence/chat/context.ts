import { and, eq, inArray } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Database } from "@lictory/core/domain/service";
import { commitVersions } from "@lictory/core/knowledge/search";
import {
  canManageSpaceAccess,
  pageAccess,
  spaceAccess,
} from "@lictory/core/spaces/access";
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
// results (a page read with getPage, a page found by search, a space's page
// tree, a merge preview) and the answers built on them. When the person can
// no longer read a page or space those touched, the model must not get it
// back from the transcript either: the tool's input and result are replaced
// by a note, and so are the words of an earlier answer that used them or
// that was asked from that page. The stored transcript is unchanged (it is
// the person's own record); only what the model is sent is withheld.
//
// What a call touched comes from its input and its result: page and space
// ids wherever they appear, and for the tools of Lictory Spaces also the
// branches, pull requests, discussions, attachments and context links they
// name (each resolved to its page), the pages and spaces their results list
// by `id`. Anything that cannot be resolved or checked counts as unreadable.
export const WITHHELD_RESULT =
  "Withheld: this read a page the person cannot read now. Do not use or repeat anything from it.";
export const WITHHELD_ANSWER =
  "[An earlier answer drawn from a page the person cannot read now; withheld. Do not repeat anything from it.]";
// More distinct pages and spaces than this in one conversation are not
// checked one by one; the rest count as unreadable.
const MAX_CHECKED = 200;
const MAX_DEPTH = 12;

// Tools of Lictory Spaces and of the links between pages and work, whose
// branch, pull request, discussion, attachment and link ids name pages
// (elsewhere `branchId` names a specification branch).
const spacesToolExtras = new Set([
  "commitDraft",
  "getWorkItemKnowledge",
  "listReferencesTo",
]);
export const isSpacesTool = (name: string) =>
  /Page|Space/.test(name) || spacesToolExtras.has(name);
// Commands that manage a space: a manager may name a restricted space they
// cannot read (to grant themselves access), as listSpaces lists it.
const managingTools = new Set([
  "createSpace",
  "updateSpace",
  "setSpaceAccessMode",
  "setSpaceGrant",
  "archiveSpace",
]);

// What a reference names; resolved to pages and spaces before checking.
type RefKind =
  | "page"
  | "space"
  | "managedSpace"
  | "pageBranch"
  | "pagePullRequest"
  | "pageThread"
  | "pageAttachment"
  | "contextLink"
  // Too deep or malformed to check.
  | "unchecked";
const spacesKeys: Record<string, RefKind> = {
  branchId: "pageBranch",
  sourceBranchId: "pageBranch",
  targetBranchId: "pageBranch",
  fromBranchId: "pageBranch",
  pullRequestId: "pagePullRequest",
  threadId: "pageThread",
  attachmentId: "pageAttachment",
  linkId: "contextLink",
};
const ref = (kind: RefKind, id: string) => `${kind}:${id}`;

function collect(
  value: unknown,
  into: Set<string>,
  spaces: boolean,
  depth = 0,
) {
  if (value === null || typeof value !== "object") return;
  if (depth > MAX_DEPTH) {
    into.add(ref("unchecked", ""));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collect(v, into, spaces, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  // A page named by kind (a reference, a search result).
  if (record.kind === "page" && typeof record.id === "string")
    into.add(ref("page", record.id));
  for (const [key, v] of Object.entries(record)) {
    const kind =
      key === "pageId"
        ? "page"
        : key === "spaceId"
          ? "space"
          : spaces
            ? spacesKeys[key]
            : undefined;
    if (kind && typeof v === "string")
      into.add(v.length <= 100 ? ref(kind, v) : ref("unchecked", ""));
    else collect(v, into, spaces, depth + 1);
  }
}

type Part = ChatMessage["parts"][number];
type ToolPart = {
  type: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  state?: string;
};
const toolPart = (part: Part) =>
  part.type.startsWith("tool-") || part.type === "dynamic-tool"
    ? (part as ToolPart)
    : null;
const nameOf = (tool: ToolPart) =>
  tool.type === "dynamic-tool" ? (tool.toolName ?? "") : tool.type.slice(5);
const ids = (list: unknown) =>
  Array.isArray(list)
    ? list.flatMap((x) =>
        typeof (x as { id?: unknown } | null)?.id === "string"
          ? [(x as { id: string }).id]
          : [],
      )
    : [];

// The references a tool call's input and result make.
function referencesOfTool(part: Part): Set<string> {
  const refs = new Set<string>();
  const tool = toolPart(part);
  if (!tool) return refs;
  const name = nameOf(tool);
  const spaces = isSpacesTool(name);
  collect(tool.input, refs, spaces);
  collect(tool.output, refs, spaces);
  const result = (tool.output as { result?: Record<string, unknown> } | null)
    ?.result;
  if (result && typeof result === "object") {
    // Page trees and space lists name their entries by `id`.
    if (name === "listPages") {
      for (const id of ids(result.pages)) refs.add(ref("page", id));
      const space = (result.space as { id?: unknown } | undefined)?.id;
      if (typeof space === "string") refs.add(ref("space", space));
    }
    if (name === "getPage") {
      const page = (result.page as { id?: unknown } | undefined)?.id;
      if (typeof page === "string") refs.add(ref("page", page));
    }
    if (name === "listSpaces") {
      for (const id of ids(result.spaces)) refs.add(ref("space", id));
      for (const id of ids(result.manageableWithoutAccess))
        refs.add(ref("managedSpace", id));
    }
  }
  if (managingTools.has(name))
    for (const r of [...refs])
      if (r.startsWith("space:")) {
        refs.delete(r);
        refs.add(ref("managedSpace", r.slice("space:".length)));
      }
  return refs;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

// The page each branch, pull request, discussion, attachment or context
// link names, in the actor's organization; missing ones are left out.
async function pagesOf(
  tx: Tx,
  organizationId: string,
  kind: RefKind,
  wanted: string[],
): Promise<Map<string, string>> {
  const table =
    kind === "pageBranch"
      ? s.pageBranch
      : kind === "pagePullRequest"
        ? s.pagePullRequest
        : kind === "pageThread"
          ? s.pageThread
          : kind === "pageAttachment"
            ? s.workItemPageAttachment
            : kind === "contextLink"
              ? s.pageContextLink
              : null;
  if (!table || !wanted.length) return new Map();
  const rows = await tx
    .select({ id: table.id, pageId: table.pageId })
    .from(table)
    .where(
      and(eq(table.organizationId, organizationId), inArray(table.id, wanted)),
    );
  return new Map(rows.map((r) => [r.id, r.pageId]));
}

export async function withholdUnreadablePages(
  db: Database,
  actor: { organizationId: string; userId: string },
  messages: readonly ChatMessage[],
  contexts: ReadonlyMap<string, VerifiedPage | null>,
): Promise<ChatMessage[]> {
  const refsOf = new Map<Part, Set<string>>();
  for (const message of messages)
    for (const part of message.parts) {
      const refs = referencesOfTool(part);
      if (refs.size) refsOf.set(part, refs);
    }
  const named = new Set([...refsOf.values()].flatMap((r) => [...r]));
  const unreadable = new Set<string>();
  if (named.size)
    await db.transaction(
      async (tx) => {
        let checked = 0;
        const within = () => checked++ < MAX_CHECKED;
        const byKind = new Map<RefKind, string[]>();
        for (const r of named) {
          const at = r.indexOf(":");
          const kind = r.slice(0, at) as RefKind;
          byKind.set(kind, [...(byKind.get(kind) ?? []), r.slice(at + 1)]);
        }
        // Page access, checked once per page.
        const pageReadable = new Map<string, boolean>();
        const canReadPage = async (pageId: string) => {
          let readable = pageReadable.get(pageId);
          if (readable === undefined) {
            readable =
              within() && Boolean((await pageAccess(tx, actor, pageId))?.level);
            pageReadable.set(pageId, readable);
          }
          return readable;
        };
        for (const [kind, wanted] of byKind) {
          if (kind === "unchecked") {
            unreadable.add(ref(kind, ""));
            continue;
          }
          if (kind === "page") {
            for (const id of wanted)
              if (!(await canReadPage(id))) unreadable.add(ref(kind, id));
            continue;
          }
          if (kind === "space" || kind === "managedSpace") {
            for (const id of wanted) {
              const ok =
                within() &&
                (Boolean((await spaceAccess(tx, actor, id))?.level) ||
                  (kind === "managedSpace" &&
                    (await canManageSpaceAccess(tx, actor, id))));
              if (!ok) unreadable.add(ref(kind, id));
            }
            continue;
          }
          const bounded = wanted.slice(0, MAX_CHECKED);
          const pages = await pagesOf(tx, actor.organizationId, kind, bounded);
          for (const id of wanted) {
            const pageId = pages.get(id);
            if (!pageId || !(await canReadPage(pageId)))
              unreadable.add(ref(kind, id));
          }
        }
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  const namesUnreadable = (part: Part) =>
    [...(refsOf.get(part) ?? [])].some((r) => unreadable.has(r));
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
