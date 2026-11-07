import * as Y from "yjs";
import { markdownSchema } from "@lictory/core/editor/schema";
import { draftStateToMarkdownDocument } from "@lictory/core/editor/draft-state";
import {
  serializeMarkdown,
  type MarkdownJSON,
} from "@lictory/core/editor/markdown";
import { recoveryPrefix } from "@lictory/platform/data/recovery";
import {
  draftRecoveryStore,
  type RecoveredDraft,
} from "@lictory/platform/components/spaces/editor/recovery";

// Text typed into a live specification draft that would otherwise be lost
// when the editor closes it (docs/internals/specification-drafts.md): edits
// the collaboration service never stored, and, when the draft was replaced
// by a new epoch (a revision saved another way, a merged pull request, a
// synced branch), this person's edits of that epoch that the new head does
// not contain. Kept in this browser only, per person, organization, item and
// line, with the store of page drafts (and removed with it on sign out);
// offered back as "Copy text", "Insert at end" (an ordinary edit) or
// "Discard". Nothing is put back without the person asking.

// One key per line (a line has one draft): `main` or the branch id.
export const specDraftRecoveryKey = (
  userId: string,
  organizationId: string,
  workItemId: string,
  line: string,
) =>
  `${recoveryPrefix(userId)}${organizationId}:specification:${workItemId}:${line}`;

export const specDraftRecoveryStore = draftRecoveryStore;

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

const markdownOfBlocks = (blocks: MarkdownJSON[]) =>
  serializeMarkdown({ type: "doc", content: blocks });

// A replaced epoch: every top-level block of the draft that neither the
// Markdown the epoch was based on nor the line's new head contains (edits
// stored or not, whoever typed them: the server refuses them all now), and
// the working title when it differs.
export function replacedSpecificationText(
  doc: Y.Doc,
  documentName: string,
  base: string,
  head: string,
  headTitle: string,
): RecoveredDraft | null {
  let blocks: MarkdownJSON[];
  try {
    blocks = draftStateToMarkdownDocument(doc).content ?? [];
  } catch {
    blocks = doc
      .getXmlFragment("default")
      .toArray()
      .flatMap((child) => {
        const text = plainText(child).trim();
        return text
          ? [{ type: "paragraph", content: [{ type: "text", text }] }]
          : [];
      });
  }
  blocks = blocks.filter((block) => {
    const text = markdownOfBlocks([block]).trim();
    return text && !base.includes(text) && !head.includes(text);
  });
  const ownTitle = doc.getText("title").toJSON().trim();
  const title = ownTitle && ownTitle !== headTitle ? ownTitle : null;
  if (!blocks.length && !title) return null;
  return {
    id: crypto.randomUUID(),
    documentName,
    keptAt: Date.now(),
    title,
    blocks,
    markdown: markdownOfBlocks(blocks),
  };
}

// The top-level blocks this tab's own edits from `fromClock` on are in, as
// Markdown-schema JSON, and the working title when they changed it. Blocks
// whose Markdown the line's new head already contains are left out.
export function keptSpecificationText(
  doc: Y.Doc,
  fromClock: number,
  documentName: string,
  headMarkdown?: string,
): RecoveredDraft | null {
  const fragment = doc.getXmlFragment("default");
  const titleText = doc.getText("title");
  const touched = new Set<Y.Item>();
  let titleTouched = false;
  for (const struct of doc.store.clients.get(doc.clientID) ?? []) {
    if (!(struct instanceof Y.Item) || struct.deleted) continue;
    if (struct.id.clock + struct.length <= fromClock) continue;
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
  let blocks: MarkdownJSON[];
  try {
    const document = draftStateToMarkdownDocument(doc);
    blocks = indices.flatMap((index) => {
      const block = document.content?.[index];
      return block ? [block] : [];
    });
  } catch {
    // A draft the schema cannot read still gives its words back.
    blocks = indices.flatMap((index) => {
      const text = plainText(children[index]!).trim();
      return text
        ? [{ type: "paragraph", content: [{ type: "text", text }] }]
        : [];
    });
  }
  blocks = blocks.filter((block) => {
    const text = markdownOfBlocks([block]).trim();
    return text && !(headMarkdown ?? "").includes(text);
  });
  const title = titleTouched ? titleText.toJSON() : null;
  if (!blocks.length && !title?.trim()) return null;
  return {
    id: crypto.randomUUID(),
    documentName,
    keptAt: Date.now(),
    title,
    blocks,
    markdown: markdownOfBlocks(blocks),
  };
}

// The kept blocks, checked against the Markdown schema, to insert into the
// current draft. Null when they are not valid content.
export function insertableSpecificationBlocks(
  entry: RecoveredDraft,
): MarkdownJSON[] | null {
  if (!entry.blocks.length) return null;
  try {
    const node = markdownSchema.nodeFromJSON({
      type: "doc",
      content: entry.blocks,
    });
    node.check();
    return (node.toJSON() as MarkdownJSON).content ?? null;
  } catch {
    return null;
  }
}
