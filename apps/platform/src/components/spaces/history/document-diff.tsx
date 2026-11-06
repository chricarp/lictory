import { useCallback, useMemo } from "react";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { diffDocuments } from "@lictory/core/spaces/document/diff";
import {
  canonicalizeDocument,
  stableSerialize,
  type PageNode,
} from "@lictory/core/spaces/document/canonical";
import { PageReader } from "@lictory/platform/components/spaces/editor/document";
import { changedWords, type TextRange } from "./word-diff";

export function DocumentDiff({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  if (before === after) return null;
  const ranges = changedWords(before, after);
  const text = (value: string, spans: TextRange[], kind: "ins" | "del") => {
    const result = [];
    let offset = 0;
    for (const span of spans) {
      result.push(value.slice(offset, span.from));
      result.push(
        kind === "ins" ? (
          <ins key={span.from}>{value.slice(span.from, span.to)}</ins>
        ) : (
          <del key={span.from}>{value.slice(span.from, span.to)}</del>
        ),
      );
      offset = span.to;
    }
    result.push(value.slice(offset));
    return result;
  };
  return (
    <div className="history-word-diff overflow-hidden rounded-lg border text-sm">
      <div className="border-b px-4 py-3">
        <span className="mr-3 text-xs text-muted-foreground">Before title</span>
        {text(before || "Untitled", ranges.before, "del")}
      </div>
      <div className="px-4 py-3">
        <span className="mr-3 text-xs text-muted-foreground">After title</span>
        {text(after || "Untitled", ranges.after, "ins")}
      </div>
    </div>
  );
}

export function RenderedDocumentDiff({
  before,
  after,
  beforeLabel = "Base version",
  afterLabel = "Result",
}: {
  before: unknown;
  after: unknown;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const groups = useMemo(() => {
    const base = canonicalizeDocument(before),
      result = canonicalizeDocument(after);
    const old = new Map(
      (base.content ?? []).map((node) => [String(node.attrs?.id), node]),
    );
    const next = new Map(
      (result.content ?? []).map((node) => [String(node.attrs?.id), node]),
    );
    const changes = diffDocuments(base, result)
      .filter((change) => old.has(change.blockId) || next.has(change.blockId))
      .filter(
        (change) =>
          !(
            change.kind === "removed" &&
            base.content?.length === 1 &&
            base.content[0]?.type === "paragraph" &&
            !base.content[0].content?.length
          ),
      );
    const grouped: { kind: string; before: PageNode[]; after: PageNode[] }[] =
      [];
    for (const change of changes) {
      // Keep modified pairs separate so word offsets are local to each block.
      let group = grouped.at(-1);
      if (
        group?.kind !== change.kind ||
        change.kind === "changed" ||
        change.kind === "moved"
      ) {
        group = { kind: change.kind, before: [], after: [] };
        grouped.push(group);
      }
      const a = old.get(change.blockId),
        b = next.get(change.blockId);
      if (a) group.before.push(a);
      if (b) group.after.push(b);
    }
    return grouped;
  }, [before, after]);
  const count = groups
    .filter((g) => g.kind !== "unchanged")
    .reduce((sum, g) => sum + Math.max(g.before.length, g.after.length), 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {beforeLabel} → {afterLabel}
        </span>
        <span>
          {count} {count === 1 ? "block changed" : "blocks changed"}
        </span>
      </div>
      {!count && (
        <p className="rounded-lg bg-muted/50 p-5 text-sm text-muted-foreground">
          No document changes between these versions.
        </p>
      )}
      {groups.map((group, index) => {
        if (group.kind === "unchanged")
          return (
            <details
              key={index}
              className="rounded-lg border border-dashed text-sm"
            >
              <summary className="min-h-9 cursor-pointer rounded-lg px-4 py-2 text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">
                {group.after.length} unchanged{" "}
                {group.after.length === 1 ? "block" : "blocks"}
              </summary>
              <Block nodes={group.after} kind="context" />
            </details>
          );
        const movedOnly =
          group.kind === "moved" &&
          stableSerialize(group.before) === stableSerialize(group.after);
        const words =
          group.before.length && group.after.length
            ? changedWords(plainText(group.before), plainText(group.after))
            : undefined;
        return (
          <section
            key={index}
            aria-label={`${group.kind} block`}
            className="overflow-hidden rounded-xl border"
          >
            <div className="border-b bg-muted/40 px-4 py-2 text-xs font-medium">
              {group.kind === "moved"
                ? movedOnly
                  ? "Moved · position changed"
                  : "Moved and edited"
                : group.kind === "changed"
                  ? "Edited"
                  : group.kind === "added"
                    ? "Added"
                    : "Removed"}
            </div>
            {!movedOnly && group.before.length > 0 && (
              <Block
                nodes={group.before}
                kind="removed"
                ranges={words?.before}
              />
            )}
            {group.after.length > 0 && (
              <Block
                nodes={group.after}
                kind={movedOnly ? "context" : "added"}
                ranges={words?.after}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
const wordHighlights = new PluginKey("history-word-highlights");
function plainText(nodes: PageNode[]): string {
  return nodes
    .map((node) => node.text ?? plainText(node.content ?? []))
    .join("");
}
function Block({
  nodes,
  kind,
  ranges,
}: {
  nodes: PageNode[];
  kind: "added" | "removed" | "context";
  ranges?: TextRange[];
}) {
  const content = useMemo(() => ({ type: "doc", content: nodes }), [nodes]);
  const highlight = useCallback(
    (editor: Editor | null) => {
      if (!editor || editor.isDestroyed) return;
      editor.unregisterPlugin(wordHighlights);
      if (!ranges?.length) return;
      const decorations: Decoration[] = [];
      let offset = 0;
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return;
        for (const range of ranges) {
          const from = Math.max(offset, range.from),
            to = Math.min(offset + node.nodeSize, range.to);
          if (from < to)
            decorations.push(
              Decoration.inline(pos + from - offset, pos + to - offset, {
                nodeName: kind === "added" ? "ins" : "del",
              }),
            );
        }
        offset += node.nodeSize;
      });
      const set = DecorationSet.create(editor.state.doc, decorations);
      editor.registerPlugin(
        new Plugin({ key: wordHighlights, props: { decorations: () => set } }),
        (plugin, plugins) => [
          ...plugins.filter((current) => current.spec.key !== wordHighlights),
          plugin,
        ],
      );
    },
    [kind, ranges],
  );
  return (
    <div
      className={`history-word-diff border-l-2 px-5 py-4 [&_.page-document]:min-h-0 ${kind === "added" ? "border-l-success bg-success/5" : kind === "removed" ? "border-l-destructive bg-destructive/5" : "border-l-transparent"}`}
    >
      <PageReader
        content={content}
        label={
          kind === "added"
            ? "After changes"
            : kind === "removed"
              ? "Before changes"
              : "Unchanged content"
        }
        onEditor={highlight}
      />
    </div>
  );
}
