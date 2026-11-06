import * as Y from "yjs";
import type { EditorState } from "@tiptap/pm/state";
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import type { PageThreadAnchor } from "@lictory/core/contracts/protocol";
import {
  quoteOf,
  type Range,
} from "@lictory/platform/components/spaces/comments/anchors";

// Draft anchors: Yjs relative positions in one epoch of a live draft,
// which follow concurrent edits. Committing the draft freezes them into
// commit anchors on the server.

export type DraftAnchor = Extract<PageThreadAnchor, { kind: "draft" }>;

const encode = (position: Y.RelativePosition) => {
  const bytes = Y.encodeRelativePosition(position);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const decode = (value: string) =>
  Y.decodeRelativePosition(
    Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
  );

function syncState(state: EditorState) {
  return ySyncPluginKey.getState(state);
}

export function draftAnchorFor(
  state: EditorState,
  from: number,
  to: number,
  draft: { id: string; epoch: number },
): DraftAnchor | null {
  const sync = syncState(state);
  if (!sync || from >= to) return null;
  const quote = quoteOf(state.doc, from, to);
  if (!quote) return null;
  const { mapping } = sync.binding;
  return {
    v: 1,
    kind: "draft",
    draftId: draft.id,
    epoch: draft.epoch,
    start: encode(absolutePositionToRelativePosition(from, sync.type, mapping)),
    end: encode(absolutePositionToRelativePosition(to, sync.type, mapping)),
    quote,
  };
}

export function resolveDraftAnchor(
  state: EditorState,
  anchor: Pick<DraftAnchor, "start" | "end">,
): Range | null {
  const sync = syncState(state);
  if (!sync) return null;
  try {
    const { mapping } = sync.binding;
    const from = relativePositionToAbsolutePosition(
      sync.doc,
      sync.type,
      decode(anchor.start),
      mapping,
    );
    const to = relativePositionToAbsolutePosition(
      sync.doc,
      sync.type,
      decode(anchor.end),
      mapping,
    );
    if (from === null || to === null || from >= to) return null;
    const size = state.doc.content.size;
    return { from: Math.min(from, size), to: Math.min(to, size) };
  } catch {
    return null;
  }
}
