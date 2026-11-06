import { z } from "zod";
import * as Y from "yjs";
import {
  canonicalizeDocument,
  type PageNode,
} from "@lictory/core/spaces/document/canonical";
import { fragmentMarkdown } from "@lictory/core/spaces/document/markdown";
import { draftStateToDocument } from "@lictory/core/spaces/document/yjs";
import {
  recoveryPrefix,
  type KeyValueStorage,
} from "@lictory/platform/data/recovery";

// Text typed into a live draft that the collaboration service never stored
// is not lost when the editor closes: a draft replaced by a new epoch (a
// restore or merge), or an editor left while "Saving…", hands its unstored
// edits to this store. The page then offers them back (copy, insert at the
// end of the current draft, discard); nothing is put back without the
// person asking. Entries live in this browser only, per person,
// organization, page and line (a line has one draft), and are removed with
// the person's other recovery entries when they sign out.

export const draftRecoveryKey = (
  userId: string,
  organizationId: string,
  pageId: string,
  draftId: string,
) => `${recoveryPrefix(userId)}${organizationId}:page:${pageId}:${draftId}`;

const entrySchema = z.object({
  id: z.string(),
  // The draft epoch the text was typed into (`<draftId>.<epoch>`).
  documentName: z.string(),
  keptAt: z.number(),
  // The working title, when the unstored edits changed it.
  title: z.string().nullable(),
  // The top-level blocks the unstored edits touched, as canonical JSON.
  blocks: z.array(z.record(z.string(), z.unknown())),
  markdown: z.string(),
});
export type RecoveredDraft = z.infer<typeof entrySchema>;

// The clock of this client's own changes to the document: everything this
// tab typed has a clock below it.
export function ownClock(doc: Y.Doc) {
  const last = doc.store.clients.get(doc.clientID)?.at(-1);
  return last ? last.id.clock + last.length : 0;
}

function plainText(type: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (type instanceof Y.XmlText)
    return (type.toDelta() as { insert: unknown }[])
      .map((op) => (typeof op.insert === "string" ? op.insert : ""))
      .join("");
  if (type instanceof Y.XmlElement)
    return type
      .toArray()
      .map((child) => plainText(child))
      .join(type.nodeName === "paragraph" ? "" : "\n");
  return "";
}

// What this tab typed and the service did not store (its own changes with a
// clock at or after `storedClock`, still present in the document): the
// top-level blocks they are in, converted by the document engine exactly as
// the server converts drafts, and the title when they changed it. Null when
// nothing of it remains (for example text typed and deleted again).
export function unstoredDraftText(
  doc: Y.Doc,
  storedClock: number,
): { title: string | null; blocks: PageNode[] } | null {
  const fragment = doc.getXmlFragment("default");
  const titleText = doc.getText("title");
  const touched = new Set<Y.Item>();
  let titleTouched = false;
  for (const struct of doc.store.clients.get(doc.clientID) ?? []) {
    if (!(struct instanceof Y.Item) || struct.deleted) continue;
    if (struct.id.clock + struct.length <= storedClock) continue;
    let item: Y.Item = struct;
    for (;;) {
      const parent = item.parent;
      if (parent === fragment) {
        touched.add(item);
        break;
      }
      if (parent === titleText) {
        titleTouched = true;
        break;
      }
      const up = parent instanceof Y.AbstractType ? parent._item : null;
      if (!up || up.deleted) break;
      item = up;
    }
  }
  const children = fragment.toArray();
  const indices = children.flatMap((child, index) =>
    child._item && touched.has(child._item) ? [index] : [],
  );
  let blocks: PageNode[];
  try {
    const document = draftStateToDocument(Y.encodeStateAsUpdate(doc));
    blocks = indices.flatMap((index) => {
      const block = document.content?.[index];
      return block ? [block] : [];
    });
  } catch {
    // A draft the engine cannot read still gives its words back.
    blocks = indices.flatMap((index) => {
      const text = plainText(children[index]!).trim();
      return text
        ? [{ type: "paragraph", content: [{ type: "text", text }] }]
        : [];
    });
  }
  // Empty blocks hold nothing to give back (an editor binding to a draft
  // before its first sync may create one).
  blocks = blocks.filter((block) => fragmentMarkdown([block]).trim());
  const title = titleTouched ? titleText.toJSON() : null;
  if (!blocks.length && !title?.trim()) return null;
  return { title, blocks };
}

export function recoveredDraft(
  doc: Y.Doc,
  storedClock: number,
  documentName: string,
): RecoveredDraft | null {
  const text = unstoredDraftText(doc, storedClock);
  if (!text) return null;
  return {
    id: crypto.randomUUID(),
    documentName,
    keptAt: Date.now(),
    title: text.title,
    blocks: text.blocks,
    markdown: fragmentMarkdown(text.blocks),
  };
}

// Plain text to paste elsewhere.
export function recoveredText(entry: RecoveredDraft) {
  return [entry.title?.trim(), entry.markdown.trim()]
    .filter(Boolean)
    .join("\n\n");
}

// The blocks to insert into another draft: validated by the engine, without
// their block ids (the editor assigns new ones, so they never collide with
// blocks the current draft still has). Null when they are not valid page
// content.
export function insertableBlocks(entry: RecoveredDraft): PageNode[] | null {
  if (!entry.blocks.length) return null;
  try {
    const document = canonicalizeDocument({
      type: "doc",
      content: entry.blocks,
    });
    const strip = (node: PageNode): PageNode => {
      const attrs = node.attrs ? { ...node.attrs } : undefined;
      if (attrs) delete attrs.id;
      return {
        ...node,
        ...(attrs ? { attrs } : {}),
        ...(node.content ? { content: node.content.map(strip) } : {}),
      };
    };
    return (document.content ?? []).map(strip);
  } catch {
    return null;
  }
}

export class DraftRecoveryStore {
  private listeners = new Set<() => void>();
  private cache: RecoveredDraft[] | undefined;
  constructor(
    private storage: KeyValueStorage | undefined,
    readonly key: string,
  ) {}

  list(): RecoveredDraft[] {
    if (this.cache) return this.cache;
    let entries: RecoveredDraft[] = [];
    try {
      const raw = this.storage?.getItem(this.key);
      const parsed = raw
        ? z.array(z.unknown()).safeParse(JSON.parse(raw))
        : undefined;
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

  private write(entries: RecoveredDraft[]) {
    this.cache = entries;
    try {
      if (entries.length)
        this.storage?.setItem(this.key, JSON.stringify(entries));
      else this.storage?.removeItem(this.key);
    } catch {
      // Storage full or unavailable: this tab still offers the text.
    }
    for (const listener of this.listeners) listener();
  }

  put(entry: RecoveredDraft) {
    this.write([...this.list().filter((e) => e.id !== entry.id), entry]);
  }

  remove(id: string) {
    if (!this.list().some((e) => e.id === id)) return;
    this.write(this.list().filter((e) => e.id !== id));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.list();
}

// One store per key in a tab, so the editor of the new epoch sees what the
// closing editor of the old one kept.
const stores = new Map<string, DraftRecoveryStore>();
export function draftRecoveryStore(key: string) {
  let store = stores.get(key);
  if (!store) {
    let storage: KeyValueStorage | undefined;
    try {
      storage = typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
      storage = undefined;
    }
    store = new DraftRecoveryStore(storage, key);
    stores.set(key, store);
  }
  return store;
}
