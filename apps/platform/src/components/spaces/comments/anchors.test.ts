import assert from "node:assert/strict";
import { test } from "node:test";
import { pageSchema } from "@lictory/core/spaces/document/schema";
import {
  storedSequenceOf,
  draftStoredPayload,
  CLOSE_REASONS,
} from "@lictory/core/spaces/collaboration-protocol";
import {
  blockIndex,
  commitAnchorFor,
  resolveCommitAnchor,
} from "@lictory/platform/components/spaces/comments/anchors";
import { createDiscussionsMemo } from "@lictory/platform/components/spaces/comments/store";
import { versionOf } from "@lictory/platform/components/spaces/editor/line";
import {
  closedKindOf,
  saveStateOf,
  type SessionSnapshot,
} from "@lictory/platform/components/spaces/editor/session";
import type { SpaceEntity } from "@lictory/core/contracts/protocol";
import type { PageCommit } from "@lictory/platform/data/spaces";

const doc = (...blocks: { id: string; content: Record<string, unknown>[] }[]) =>
  pageSchema.nodeFromJSON({
    type: "doc",
    content: blocks.map((b) => ({
      type: "paragraph",
      attrs: { id: b.id },
      content: b.content,
    })),
  });
const text = (value: string) => ({ type: "text", text: value });
const ref = (key: string) => ({
  type: "workItemRef",
  attrs: { workItemId: "item-1", key },
});

void test("a selection becomes a commit anchor on its first block, offsets as ProseMirror counts them", () => {
  const d = doc(
    {
      id: "a",
      content: [text("Refunds take "), ref("PAY-1"), text(" five days.")],
    },
    { id: "b", content: [text("Second block")] },
  );
  // Positions: doc start 0, paragraph "a" opens at 0, its content at 1.
  const from = 1 + "Refunds take ".length;
  const to = from + 1 + " five".length;
  const anchor = commitAnchorFor(d, from, to, "commit-1");
  assert.deepEqual(anchor, {
    v: 1,
    kind: "commit",
    commitId: "commit-1",
    blockId: "a",
    from: 13,
    to: 19,
    quote: "PAY-1 five",
  });
  // A selection running into the next block is cut at the end of the first.
  const across = commitAnchorFor(d, 1 + "Refunds take ".length + 2, 40, "c");
  assert.equal(across?.blockId, "a");
  assert.equal(across?.to, d.firstChild!.content.size);
  assert.equal(commitAnchorFor(d, 3, 3, "c"), null);
});

void test("a commit anchor finds its text while the block and the words survive", () => {
  const original = doc({ id: "a", content: [text("Refunds take five days.")] });
  const anchor = commitAnchorFor(original, 14, 23, "c")!;
  assert.equal(anchor.quote, "five days");
  const index = blockIndex(original);
  assert.deepEqual(resolveCommitAnchor(original, index, anchor), {
    from: 14,
    to: 23,
  });
  // Text inserted before the quote: found again in the same block.
  const edited = doc(
    { id: "z", content: [text("New intro")] },
    { id: "a", content: [text("All refunds take five days.")] },
  );
  const moved = resolveCommitAnchor(edited, blockIndex(edited), anchor)!;
  assert.equal(edited.textBetween(moved.from, moved.to), "five days");
  // The words changed, or the block is gone: no range.
  const changed = doc({ id: "a", content: [text("Refunds take a week.")] });
  assert.equal(resolveCommitAnchor(changed, blockIndex(changed), anchor), null);
  const removed = doc({ id: "other", content: [text("five days")] });
  assert.equal(resolveCommitAnchor(removed, blockIndex(removed), anchor), null);
});

void test("the stored sequence comes only from the service's stored messages", () => {
  assert.equal(storedSequenceOf(draftStoredPayload(12)), 12);
  assert.equal(storedSequenceOf('{"type":"lictory.draft.stored"}'), null);
  assert.equal(storedSequenceOf('{"type":"other","sequence":3}'), null);
  assert.equal(storedSequenceOf("not json"), null);
  assert.equal(
    storedSequenceOf('{"type":"lictory.draft.stored","sequence":-1}'),
    null,
  );
});

void test("save state: Saved only when the service stored every edit", () => {
  const base: SessionSnapshot = {
    status: "connected" as SessionSnapshot["status"],
    everSynced: true,
    unsynced: false,
    storedSequence: 4,
    readOnly: false,
    online: true,
    unavailable: false,
    closed: null,
    peers: [],
  };
  assert.equal(saveStateOf(base).label, "Saved");
  assert.equal(saveStateOf({ ...base, unsynced: true }).label, "Saving…");
  assert.equal(
    saveStateOf({ ...base, online: false, unsynced: true }).label,
    "Offline — changes kept on this device",
  );
  assert.equal(
    saveStateOf({
      ...base,
      status: "disconnected" as SessionSnapshot["status"],
    }).kind,
    "offline",
  );
  assert.equal(
    saveStateOf({ ...base, everSynced: false }).label,
    "Connecting…",
  );
  assert.equal(
    saveStateOf({ ...base, everSynced: false, unavailable: true }).label,
    "Live editing unavailable",
  );
  assert.equal(
    saveStateOf({ ...base, closed: "revoked" }).label,
    CLOSE_REASONS.revoked,
  );
  assert.equal(closedKindOf(CLOSE_REASONS.replaced), "replaced");
  assert.equal(closedKindOf("Changes not saved yet; reconnecting."), null);
});

void test("versions count the first-parent chain", () => {
  const commit = (id: string, parentIds: string[]) =>
    ({ id, parentIds }) as unknown as PageCommit;
  const commits = [
    commit("c1", []),
    commit("b1", ["c1"]),
    commit("c2", ["c1"]),
    commit("c3", ["c2", "b1"]),
  ];
  assert.equal(versionOf(commits, "c1"), 1);
  assert.equal(versionOf(commits, "c3"), 3);
  assert.equal(versionOf(commits, "b1"), 2);
  assert.equal(versionOf(commits, "missing"), undefined);
});

void test("discussions keep their identity while nothing in them changes", () => {
  const thread = {
    type: "pageThread",
    id: "t1",
    createdAt: "2026-01-01T00:00:00Z",
  } as unknown as SpaceEntity;
  const message = (id: string) =>
    ({
      type: "pageThreadMessage",
      id,
      threadId: "t1",
      createdAt: `2026-01-01T00:00:0${id.slice(1)}Z`,
    }) as unknown as SpaceEntity;
  const commit = { type: "pageCommit", id: "c1" } as unknown as SpaceEntity;
  const memo = createDiscussionsMemo();
  const first = memo(
    new Map([
      ["thread:t1", thread],
      ["m:m1", message("m1")],
    ]),
  );
  const m1 = first.messages.get("t1")![0]!;
  const same = memo(
    new Map([
      ["thread:t1", thread],
      ["m:m1", m1],
      ["commit:c1", commit],
    ]),
  );
  assert.equal(same, first);
  const replied = memo(
    new Map([
      ["thread:t1", thread],
      ["m:m1", m1],
      ["m:m2", message("m2")],
    ]),
  );
  assert.notEqual(replied, first);
  assert.equal(replied.threads, replied.threads);
  assert.equal(replied.messages.get("t1")!.length, 2);
});
