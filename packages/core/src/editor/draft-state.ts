import * as Y from "yjs";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "y-prosemirror";
import { markdownSchema } from "@lictory/core/editor/schema";
import {
  parseMarkdown,
  serializeMarkdown,
  type MarkdownJSON,
} from "@lictory/core/editor/markdown";
import { DomainError } from "@lictory/core/domain/errors";

// Markdown ⇄ the Yjs state of a live specification draft
// (docs/internals/specification-drafts.md): the `default` fragment of the
// Markdown editor's schema, which the collaborative editor binds. Shared by
// the server (seeding epochs, sealing cuts) and the browser (unsaved text,
// the uncommitted diff), so both read a draft identically.

// The Yjs state of a Markdown text.
export function markdownToDraftState(markdown: string): Uint8Array {
  const doc = prosemirrorJSONToYDoc(
    markdownSchema,
    parseMarkdown(markdown).doc,
    "default",
  );
  try {
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

const unreadable = () =>
  new DomainError(
    "validation",
    "This specification draft cannot be read as Markdown. Reopen the editor and try again.",
  );

// The document a draft holds, checked against the Markdown schema.
export function draftStateToMarkdownDocument(
  state: Uint8Array | Y.Doc,
): MarkdownJSON {
  const doc = state instanceof Y.Doc ? state : new Y.Doc();
  try {
    if (!(state instanceof Y.Doc)) Y.applyUpdate(doc, state);
    const json = yDocToProsemirrorJSON(doc, "default") as MarkdownJSON;
    const node = markdownSchema.nodeFromJSON(
      json.content?.length
        ? json
        : { type: "doc", content: [{ type: "paragraph" }] },
    );
    node.check();
    return node.toJSON() as MarkdownJSON;
  } catch {
    throw unreadable();
  } finally {
    if (!(state instanceof Y.Doc)) doc.destroy();
  }
}

// The Markdown of a draft. `source` is the Markdown its saved state is (the
// line's head): blocks nobody changed are written back byte for byte.
export function draftStateToMarkdown(
  state: Uint8Array | Y.Doc,
  source: string,
): string {
  return serializeMarkdown(
    draftStateToMarkdownDocument(state),
    parseMarkdown(source),
  );
}
