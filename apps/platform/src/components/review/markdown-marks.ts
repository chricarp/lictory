import type { Nodes, Root } from "mdast";
import {
  markText,
  textModel,
  type Mark,
} from "@lictory/core/editor/markdown-text";
import type { TextRange } from "@lictory/core/editor/word-diff";

// Remark plugins for the Markdown reader (items/markdown.tsx) that wrap
// passages of a document's readable text (editor/markdown-text.ts): the
// quotes of open discussions as <mark>, changed words as <ins>/<del>.
// Offsets are those the panel and the diff computed from the same source.

export type ThreadMark = { threadId: string; blocking: boolean };

// Tints of discussed passages; the selected and pointed-at thread read
// stronger (rules in specification.tsx).
export const anchorClass =
  "spec-anchor cursor-pointer rounded-[3px] bg-warning/18 text-inherit transition-[background-color] duration-150 ease-out";
export const blockingAnchorClass = "spec-anchor-blocking bg-destructive/12";

export function threadMarks(ranges: readonly Mark<ThreadMark>[]) {
  return () => (tree: Root) =>
    markText(textModel(tree), ranges, (children, data): Nodes => ({
      type: "emphasis",
      data: {
        hName: "mark",
        hProperties: {
          className: (data.some((d) => d.blocking)
            ? `${anchorClass} ${blockingAnchorClass}`
            : anchorClass
          ).split(" "),
          dataThreads: data.map((d) => d.threadId).join(" "),
        },
      },
      children,
    }));
}

// Changed words of one side of an edited block.
export function wordMarks(
  ranges: readonly TextRange[],
  kind: "added" | "removed",
) {
  const marks = ranges.map((range) => ({ ...range, data: kind }));
  return () => (tree: Root) =>
    markText(textModel(tree), marks, (children): Nodes => ({
      type: "emphasis",
      data: {
        hName: kind === "added" ? "ins" : "del",
        hProperties: {
          className: (kind === "added"
            ? "diff-word rounded-[3px] bg-success/18 text-inherit underline decoration-success underline-offset-3"
            : "diff-word rounded-[3px] bg-destructive/14 text-inherit line-through decoration-destructive"
          ).split(" "),
        },
      },
      children,
    }));
}
