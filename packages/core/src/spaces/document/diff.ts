import {
  canonicalizeDocument,
  stableSerialize,
  type PageNode,
} from "./canonical";
import { fragmentMarkdown } from "./markdown";
export type BlockChange = {
  kind: "added" | "removed" | "changed" | "moved" | "unchanged";
  blockId: string;
  beforeMarkdown?: string;
  afterMarkdown?: string;
};
function flatten(
  n: PageNode,
  parent = "",
): { node: PageNode; parent: string }[] {
  return (n.content ?? []).flatMap((c) =>
    c.attrs?.id
      ? [{ node: c, parent }, ...flatten(c, c.attrs.id as string)]
      : [],
  );
}
/** Ordered in the resulting document, followed by removed blocks in old order. */
export function diffDocuments(before: unknown, after: unknown): BlockChange[] {
  const a = flatten(canonicalizeDocument(before)),
    b = flatten(canonicalizeDocument(after));
  const key = (e: (typeof a)[number]) => String(e.node.attrs!.id);
  const old = new Map(a.map((e) => [key(e), e])),
    next = new Map(b.map((e) => [key(e), e]));
  const common = a.filter((e) => next.has(key(e))).map(key),
    indices = new Map(common.map((id, i) => [id, i]));
  // O(n log n) LIS marks the stable subsequence; inserts don't mark following blocks moved.
  const sequence = b.filter((e) => old.has(key(e))),
    tails: number[] = [],
    predecessors: number[] = [];
  sequence.forEach((e, i) => {
    const value = indices.get(key(e))!;
    let lo = 0,
      hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const tail = sequence[tails[mid]!];
      if (tail && indices.get(key(tail))! < value) lo = mid + 1;
      else hi = mid;
    }
    predecessors[i] = lo ? tails[lo - 1]! : -1;
    tails[lo] = i;
  });
  const stable = new Set<string>();
  let cursor = tails.at(-1) ?? -1;
  while (cursor >= 0) {
    stable.add(key(sequence[cursor]!));
    cursor = predecessors[cursor]!;
  }
  return [
    ...b.map((e): BlockChange => {
      const previous = old.get(key(e));
      return {
        kind: !previous
          ? "added"
          : !stable.has(key(e)) || previous.parent !== e.parent
            ? "moved"
            : stableSerialize(previous.node) !== stableSerialize(e.node)
              ? "changed"
              : "unchanged",
        blockId: key(e),
        ...(previous
          ? { beforeMarkdown: fragmentMarkdown([previous.node]) }
          : {}),
        afterMarkdown: fragmentMarkdown([e.node]),
      };
    }),
    ...a
      .filter((e) => !next.has(key(e)))
      .map((e) => ({
        kind: "removed" as const,
        blockId: key(e),
        beforeMarkdown: fragmentMarkdown([e.node]),
      })),
  ];
}
