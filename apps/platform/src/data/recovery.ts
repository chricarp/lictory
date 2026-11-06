import { z } from "zod";
import type { Entities } from "@lictory/core/contracts/optimistic";
import {
  commandSchema,
  type Command,
  type SpaceEntity,
} from "@lictory/core/contracts/protocol";
import { sameProposedChildren } from "@lictory/core/contracts/decomposition";

// Text people wrote is kept in this browser until the server has accepted the
// command that carries it. A rejected command (or a tab closed before the
// answer) never loses a comment, a specification edit or a description: the
// entry stays here until it is confirmed, recovered or discarded.

export const recoveryKey = (userId: string, organizationId: string) =>
  `lictory:recovery:${userId}:${organizationId}`;
export const recoveryPrefix = (userId: string) => `lictory:recovery:${userId}:`;

type AuthoredField = { label: string; text: string };

// Commands whose payload is something a person composed (not a pick from a
// list). Names of labels, teams or statuses are short and easily retyped.
export function authoredText(command: Command): AuthoredField[] {
  const fields: (AuthoredField | false | undefined)[] = (() => {
    switch (command.type) {
      case "createProject":
        return [
          { label: "Name", text: command.name },
          !!command.description && {
            label: "Description",
            text: command.description,
          },
        ];
      case "createWorkItem":
        return [
          { label: "Title", text: command.title },
          !!command.description && {
            label: "Description",
            text: command.description,
          },
        ];
      case "recordDecision":
        return [
          { label: "Conclusion", text: command.title },
          { label: "Details", text: command.body },
        ];
      case "updateSpecification":
        return [
          { label: "Title", text: command.title },
          { label: "Specification", text: command.content },
          !!command.summary && { label: "Summary", text: command.summary },
        ];
      case "createThread":
      case "replyToThread":
        return [{ label: "Comment", text: command.body }];
      case "createSpace":
        return [
          { label: "Name", text: command.name },
          !!command.description && {
            label: "Description",
            text: command.description,
          },
        ];
      case "updateSpace":
        return [
          command.name !== undefined && { label: "Name", text: command.name },
          !!command.description && {
            label: "Description",
            text: command.description,
          },
        ];
      case "createPage":
        return [{ label: "Title", text: command.title }];
      case "commitBranch":
        return [
          { label: "Title", text: command.title },
          { label: "Specification", text: command.content },
          { label: "Commit message", text: command.message },
          command.proposedChildren !== undefined && {
            label: "Proposed breakdown",
            text: JSON.stringify(command.proposedChildren, null, 2),
          },
        ];
      case "syncBranch":
        return [
          !!command.title && { label: "Title", text: command.title },
          command.content !== undefined && {
            label: "Specification",
            text: command.content,
          },
          command.proposedChildren !== undefined && {
            label: "Proposed breakdown",
            text: JSON.stringify(command.proposedChildren, null, 2),
          },
        ];
      case "createPullRequest":
        return [
          { label: "Title", text: command.title },
          { label: "Description", text: command.description },
        ];
      case "createSuggestion":
      case "updateSuggestion":
        return [
          { label: "Title", text: command.title },
          { label: "Proposed text", text: command.replacement },
          { label: "Rationale", text: command.rationale },
        ];
      default:
        return [];
    }
  })();
  return fields.filter(
    (f): f is AuthoredField => !!f && f.text.trim().length > 0,
  );
}

export function carriesAuthoredText(command: Command) {
  return authoredText(command).length > 0;
}

// Plain text to copy back into an editor.
export function recoveryText(command: Command) {
  const fields = authoredText(command);
  return fields.length === 1
    ? fields[0]!.text
    : fields.map((f) => `${f.label}\n${f.text}`).join("\n\n");
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim() === (b ?? "").trim();

// Whether synchronized data already shows the command's effect, so a
// recovered entry from an earlier session can be dropped silently. Spaces
// commands are checked against the synchronized Spaces rows.
export function effectPresent(
  command: Command,
  entities: Entities,
  spaceEntities: ReadonlyMap<string, SpaceEntity> = new Map(),
): boolean {
  const all = () => Object.values(entities);
  switch (command.type) {
    case "createSpace":
      return spaceEntities.has(`space:${command.spaceId}`);
    case "createPage":
      return spaceEntities.has(`page:${command.pageId}`);
    case "updateSpace": {
      const space = spaceEntities.get(`space:${command.spaceId}`);
      return (
        space?.type === "space" &&
        (command.name === undefined || same(space.name, command.name)) &&
        (command.description === undefined ||
          same(space.description, command.description))
      );
    }
    case "createProject":
      return !!entities[`project:${command.projectId}`];
    case "recordDecision":
      return !!entities[`decision:${command.decisionId}`];
    case "createWorkItem":
      return !!entities[`workItem:${command.workItemId}`];
    case "createThread":
      return !!entities[`thread:${command.threadId}`];
    case "replyToThread":
      return !!entities[`message:${command.messageId}`];
    case "createSuggestion":
      return !!entities[`suggestion:${command.suggestionId}`];
    case "createPullRequest":
      return !!entities[`pullRequest:${command.pullRequestId}`];
    case "updateSuggestion": {
      const s = entities[`suggestion:${command.suggestionId}`];
      return (
        s?.type === "suggestion" &&
        same(s.replacement, command.replacement) &&
        same(s.title, command.title) &&
        same(s.rationale, command.rationale)
      );
    }
    case "updateSpecification":
      return all().some(
        (e) =>
          e.type === "revision" &&
          e.workItemId === command.workItemId &&
          same(e.content, command.content) &&
          same(e.title, command.title),
      );
    case "commitBranch":
      return all().some(
        (e) =>
          e.type === "specCommit" &&
          e.workItemId === command.workItemId &&
          same(e.content, command.content) &&
          same(e.title, command.title) &&
          (command.proposedChildren === undefined ||
            sameProposedChildren(
              e.proposedChildren,
              command.proposedChildren,
            )) &&
          same(e.message, command.message),
      );
    case "syncBranch":
      return all().some(
        (e) =>
          e.type === "specCommit" &&
          e.workItemId === command.workItemId &&
          same(e.content, command.content) &&
          (command.title === undefined || same(e.title, command.title)) &&
          (command.proposedChildren === undefined ||
            sameProposedChildren(e.proposedChildren, command.proposedChildren)),
      );
    default:
      return false;
  }
}

// The work item whose history must be loaded to check an entry.
export function recoveryScope(command: Command): string | undefined {
  if (command.type === "createWorkItem" || command.type === "createProject")
    return undefined;
  return "workItemId" in command ? command.workItemId : undefined;
}

const entrySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  command: commandSchema,
  createdAt: z.number(),
  // pending: sent, no answer yet (or the tab closed before it arrived).
  // rejected: the server refused it; the text is kept for recovery.
  state: z.enum(["pending", "rejected"]),
  error: z.string().optional(),
});
export type RecoveryEntry = z.infer<typeof entrySchema>;

export type KeyValueStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export class RecoveryStore {
  private listeners = new Set<() => void>();
  private cache: RecoveryEntry[] | undefined;
  constructor(
    private storage: KeyValueStorage | undefined,
    readonly key: string,
  ) {}

  list(): RecoveryEntry[] {
    if (this.cache) return this.cache;
    let entries: RecoveryEntry[] = [];
    try {
      const raw = this.storage?.getItem(this.key);
      const parsed = raw
        ? z.array(z.unknown()).safeParse(JSON.parse(raw))
        : undefined;
      // Keep every readable entry even if one was written by another version.
      entries = (parsed?.data ?? []).flatMap((value) => {
        const entry = entrySchema.safeParse(value);
        return entry.success ? [entry.data] : [];
      });
    } catch {
      entries = [];
    }
    this.cache = entries;
    return entries;
  }

  private write(entries: RecoveryEntry[]) {
    this.cache = entries;
    try {
      if (entries.length)
        this.storage?.setItem(this.key, JSON.stringify(entries));
      else this.storage?.removeItem(this.key);
    } catch {
      // Storage full or unavailable: the in-memory copy still offers recovery
      // in this tab.
    }
    for (const listener of this.listeners) listener();
  }

  put(
    entry: Omit<RecoveryEntry, "state" | "createdAt"> & Partial<RecoveryEntry>,
  ) {
    const next: RecoveryEntry = {
      state: "pending",
      createdAt: Date.now(),
      ...entry,
    };
    this.write([...this.list().filter((e) => e.id !== entry.id), next]);
  }

  reject(id: string, error: string) {
    if (!this.list().some((e) => e.id === id)) return;
    this.write(
      this.list().map((e) =>
        e.id === id ? { ...e, state: "rejected" as const, error } : e,
      ),
    );
  }

  remove(id: string) {
    if (!this.list().some((e) => e.id === id)) return;
    this.write(this.list().filter((e) => e.id !== id));
  }

  // Another tab changed the same key.
  reload() {
    this.cache = undefined;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.list();
}

// Removes every recovery entry of one person (signing out of this browser).
export function clearRecoveryFor(
  userId: string,
  storage: Pick<Storage, "length" | "key" | "removeItem"> = localStorage,
) {
  const prefixes = [recoveryPrefix(userId), `lictory:branch-draft:${userId}:`];
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key && prefixes.some((p) => key.startsWith(p))) storage.removeItem(key);
  }
}
