import * as Y from "yjs";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "y-prosemirror";
import {
  canonicalizeDocument,
  PageDocumentError,
  type PageNode,
} from "./canonical";
import { pageSchema } from "./schema";
export function documentToDraftState(json: unknown): Uint8Array {
  const doc = prosemirrorJSONToYDoc(
    pageSchema,
    canonicalizeDocument(json),
    "default",
  );
  try {
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}
export function draftStateToDocument(state: Uint8Array): PageNode {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return canonicalizeDocument(yDocToProsemirrorJSON(doc, "default"));
  } catch {
    throw new PageDocumentError(
      "The page draft could not be read. Recover a valid saved draft.",
    );
  } finally {
    doc.destroy();
  }
}
