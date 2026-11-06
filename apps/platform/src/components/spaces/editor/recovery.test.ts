import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import {
  canonicalizeDocument,
  documentToDraftState,
} from "@lictory/core/spaces/document";
import { clearRecoveryFor } from "@lictory/platform/data/recovery";
import {
  DraftRecoveryStore,
  draftRecoveryKey,
  insertableBlocks,
  ownClock,
  recoveredDraft,
  recoveredText,
} from "@lictory/platform/components/spaces/editor/recovery";

class MemoryStorage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const paragraph = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});

// A tab's copy of a stored draft: the seed and a collaborator's stored
// edit arrive from the service, so none of it is this tab's own.
function openDraft() {
  const doc = new Y.Doc();
  Y.applyUpdate(
    doc,
    documentToDraftState(
      canonicalizeDocument({
        type: "doc",
        content: [
          paragraph("b1", "Retries reuse the transaction id."),
          paragraph("b2", "Timeouts are 30 seconds."),
        ],
      }),
    ),
  );
  return { doc, storedClock: ownClock(doc) };
}

const typeInto = (doc: Y.Doc, index: number, text: string) => {
  const block = doc.getXmlFragment("default").get(index) as Y.XmlElement;
  const content = block.get(0) as Y.XmlText;
  content.insert(content.length, text);
};

void test("text this tab typed and the service did not store is kept as the blocks it touched", () => {
  const { doc, storedClock } = openDraft();
  assert.equal(storedClock, 0, "nothing of the stored draft is this tab's");
  assert.equal(recoveredDraft(doc, storedClock, "d.1"), null);

  typeInto(doc, 1, " After that the client gives up.");
  const kept = recoveredDraft(doc, storedClock, "d.1");
  assert.ok(kept);
  assert.equal(kept.documentName, "d.1");
  assert.equal(kept.title, null);
  assert.equal(kept.blocks.length, 1, "only the block that was edited");
  assert.equal(
    kept.markdown,
    "Timeouts are 30 seconds. After that the client gives up.",
  );
  assert.equal(recoveredText(kept), kept.markdown);

  // Once the service stored it, nothing is left to keep.
  assert.equal(recoveredDraft(doc, ownClock(doc), "d.1"), null);
});

void test("the working title is kept when the unstored edits changed it; typed-and-deleted text is not", () => {
  const { doc, storedClock } = openDraft();
  const fragment = doc.getXmlFragment("default");
  const scratch = new Y.XmlElement("paragraph");
  scratch.insert(0, [new Y.XmlText("scratch")]);
  fragment.push([scratch]);
  fragment.delete(fragment.length - 1, 1);
  assert.equal(recoveredDraft(doc, storedClock, "d.1"), null);

  doc.getText("title").insert(0, "Retry policy");
  const kept = recoveredDraft(doc, storedClock, "d.1");
  assert.ok(kept);
  assert.equal(kept.title, "Retry policy");
  assert.deepEqual(kept.blocks, []);
  assert.equal(recoveredText(kept), "Retry policy");
  assert.equal(insertableBlocks(kept), null, "nothing to insert");
});

void test("recovered blocks are inserted without their block ids, and only when they are valid content", () => {
  const { doc, storedClock } = openDraft();
  typeInto(doc, 0, " Always.");
  const kept = recoveredDraft(doc, storedClock, "d.1")!;
  assert.equal(
    kept.blocks[0]!.attrs && (kept.blocks[0]!.attrs as { id: string }).id,
    "b1",
  );
  const blocks = insertableBlocks(kept)!;
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.type, "paragraph");
  assert.equal(blocks[0]!.attrs?.id, undefined);
  assert.equal(
    blocks[0]!.content?.[0]?.text,
    "Retries reuse the transaction id. Always.",
  );
  assert.equal(
    insertableBlocks({ ...kept, blocks: [{ type: "script" }] }),
    null,
  );
});

void test("kept text is stored per person, organization, page and draft, and leaves with the person", () => {
  const storage = new MemoryStorage();
  const key = draftRecoveryKey("u1", "o1", "page-1", "draft-1");
  assert.equal(key, "lictory:recovery:u1:o1:page:page-1:draft-1");
  const mine = new DraftRecoveryStore(storage, key);
  const otherPage = new DraftRecoveryStore(
    storage,
    draftRecoveryKey("u1", "o1", "page-2", "draft-2"),
  );
  const { doc, storedClock } = openDraft();
  typeInto(doc, 0, " Always.");
  const kept = recoveredDraft(doc, storedClock, "draft-1.1")!;
  let notified = 0;
  mine.subscribe(() => (notified += 1));
  mine.put(kept);
  assert.equal(notified, 1);
  assert.deepEqual(otherPage.list(), []);
  // Another tab (or a reload) reads it back.
  assert.deepEqual(new DraftRecoveryStore(storage, key).list(), [kept]);
  // Unreadable entries are skipped, readable ones kept.
  storage.setItem(key, JSON.stringify([{ id: 1 }, kept]));
  assert.deepEqual(new DraftRecoveryStore(storage, key).list(), [kept]);
  mine.remove(kept.id);
  assert.deepEqual(mine.list(), []);
  assert.equal(storage.getItem(key), null);

  mine.put(kept);
  clearRecoveryFor("u1", storage);
  assert.equal(storage.getItem(key), null);
});

void test("an empty block this tab created is nothing to keep", () => {
  const { doc, storedClock } = openDraft();
  const fragment = doc.getXmlFragment("default");
  const empty = new Y.XmlElement("paragraph");
  empty.setAttribute("id", "b3");
  fragment.push([empty]);
  assert.equal(recoveredDraft(doc, storedClock, "d.1"), null);
});
