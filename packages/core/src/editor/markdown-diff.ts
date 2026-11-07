import { parseMarkdown } from "@lictory/core/editor/markdown";
import {
  parseMarkdownTree,
  textModel,
} from "@lictory/core/editor/markdown-text";
import { changedWords, type TextRange } from "@lictory/core/editor/word-diff";

// What changed between two Markdown texts, for people to read: top-level
// blocks (the editor's block model, editor/markdown.ts) matched by their
// content, an edited block paired with the block it replaced, and inside
// each pair the words that changed. Presentation only: revisions, merges and
// conflicts stay line based (contracts/diff.ts, contracts/merge.ts).

export type DiffBlock = {
  // The block's Markdown exactly as written.
  source: string;
  type: string;
};

export type BlockChange =
  | { kind: "unchanged"; blocks: DiffBlock[]; source: string }
  | { kind: "added"; blocks: DiffBlock[] }
  | { kind: "removed"; blocks: DiffBlock[] }
  | {
      kind: "changed";
      before: DiffBlock;
      after: DiffBlock;
      // Offsets into each block's readable text (editor/markdown-text.ts).
      words: { before: TextRange[]; after: TextRange[] };
    };

type Parsed = DiffBlock & { key: string; start: number; end: number };

function blocksOf(markdown: string): Parsed[] {
  const parsed = parseMarkdown(markdown);
  return parsed.blocks.map((block, index) => ({
    source: block.source,
    key: block.key,
    type: parsed.doc.content?.[index]?.type ?? "paragraph",
    start: block.start,
    end: block.end,
  }));
}

const readable = (source: string) =>
  textModel(parseMarkdownTree(source)).text;

// Longest common subsequence of block keys; past a size that would make the
// table expensive, everything between the common ends counts as replaced.
function matches(a: Parsed[], b: Parsed[]) {
  let start = 0,
    endA = a.length,
    endB = b.length;
  while (start < endA && start < endB && a[start]!.key === b[start]!.key)
    start++;
  while (endA > start && endB > start && a[endA - 1]!.key === b[endB - 1]!.key)
    endA--, endB--;
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  const n = endA - start,
    m = endB - start;
  if (n > 0 && m > 0 && n * m <= 250_000) {
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i * width + j] =
          a[start + i]!.key === b[start + j]!.key
            ? 1 + table[(i + 1) * width + j + 1]!
            : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (a[start + i]!.key === b[start + j]!.key) {
        pairs.push([start + i, start + j]);
        i++;
        j++;
      } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
      else j++;
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

export function diffMarkdown(before: string, after: string): BlockChange[] {
  const a = blocksOf(before),
    b = blocksOf(after);
  const changes: BlockChange[] = [];
  const strip = ({ source, type }: Parsed): DiffBlock => ({ source, type });
  const push = (change: BlockChange) => {
    const last = changes.at(-1);
    if (
      last &&
      last.kind === change.kind &&
      (change.kind === "added" || change.kind === "removed") &&
      (last.kind === "added" || last.kind === "removed")
    )
      last.blocks.push(...change.blocks);
    else changes.push(change);
  };
  // Removed and added blocks between two matches: pair blocks of the same
  // type in order as edits, the rest are removed or added.
  const replaced = (removed: Parsed[], added: Parsed[]) => {
    let i = 0,
      j = 0;
    while (i < removed.length || j < added.length) {
      const r = removed[i],
        d = added[j];
      if (r && d && r.type === d.type) {
        changes.push({
          kind: "changed",
          before: strip(r),
          after: strip(d),
          words: changedWords(readable(r.source), readable(d.source)),
        });
        i++;
        j++;
      } else if (r && (!d || removed.length - i >= added.length - j)) {
        push({ kind: "removed", blocks: [strip(r)] });
        i++;
      } else if (d) {
        push({ kind: "added", blocks: [strip(d)] });
        j++;
      }
    }
  };
  let i = 0,
    j = 0;
  let same: Parsed[] = [];
  const flush = () => {
    if (!same.length) return;
    changes.push({
      kind: "unchanged",
      blocks: same.map(strip),
      // The run exactly as written, separators included.
      source: after.slice(same[0]!.start, same.at(-1)!.end),
    });
    same = [];
  };
  for (const [x, y] of matches(a, b)) {
    if (x > i || y > j) {
      flush();
      replaced(a.slice(i, x), b.slice(j, y));
    }
    same.push(b[y]!);
    i = x + 1;
    j = y + 1;
  }
  if (i < a.length || j < b.length) {
    flush();
    replaced(a.slice(i), b.slice(j));
  }
  flush();
  return changes;
}
