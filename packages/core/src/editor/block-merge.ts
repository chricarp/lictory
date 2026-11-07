// A three-way merge of top-level blocks, for Markdown edited as text beside
// a shared live draft (docs/internals/specification-drafts.md): the person
// edited the Markdown of the document as it was when they opened it (the
// base); others kept typing into the draft meanwhile (theirs). Applying the
// Markdown must change only what the person changed and keep everything
// else of the current draft. Blocks are compared by their stable key
// (`blockKey` of markdown.ts), so a block counts as unchanged exactly when
// the editor would write it back byte for byte.
//
// Where only one side changed a stretch of blocks, that side wins; where
// both only added blocks at the same place, both are kept. Where both
// changed the same stretch differently, it is a conflict: nothing is chosen
// silently, the caller asks the person.

export type MergeChunk<T> =
  | { kind: "stable"; blocks: T[] }
  | { kind: "merged"; blocks: T[] }
  | { kind: "conflict"; base: T[]; mine: T[]; theirs: T[] };

// Pairs of equal positions of a longest common subsequence of `a` and `b`.
function matches(a: readonly string[], b: readonly string[]) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start])
    start += 1;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end += 1;
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  const n = a.length - start - end;
  const m = b.length - start - end;
  if (n > 0 && m > 0) {
    // Lengths of the longest common subsequence of the suffixes.
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? table[(i + 1) * width + j + 1]! + 1
            : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        pairs.push([start + i, start + j]);
        i += 1;
        j += 1;
      } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!)
        i += 1;
      else j += 1;
    }
  }
  for (let k = end; k > 0; k--) pairs.push([a.length - k, b.length - k]);
  return pairs;
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key, i) => key === b[i]);

/**
 * Merges `mine` and `theirs`, both edited from `base`, block by block.
 * `key` gives a block's stable identity.
 */
export function mergeBlocks<T>(
  base: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
  key: (block: T) => string,
): MergeChunk<T>[] {
  const baseKeys = base.map(key);
  const mineKeys = mine.map(key);
  const theirKeys = theirs.map(key);
  const toMine = new Map(matches(baseKeys, mineKeys));
  const toTheirs = new Map(matches(baseKeys, theirKeys));
  const chunks: MergeChunk<T>[] = [];
  const push = (chunk: MergeChunk<T>) => {
    const last = chunks.at(-1);
    if (
      last &&
      last.kind !== "conflict" &&
      chunk.kind !== "conflict" &&
      last.kind === chunk.kind
    )
      last.blocks.push(...chunk.blocks);
    else if (chunk.kind === "conflict" || chunk.blocks.length)
      chunks.push(chunk);
  };
  let b = 0;
  let m = 0;
  let t = 0;
  while (b <= base.length) {
    // The next base block both sides kept, in order.
    let next = b;
    while (
      next < base.length &&
      !((toMine.get(next) ?? -1) >= m && (toTheirs.get(next) ?? -1) >= t)
    )
      next += 1;
    const mineEnd = next < base.length ? toMine.get(next)! : mine.length;
    const theirEnd = next < base.length ? toTheirs.get(next)! : theirs.length;
    const baseKeysHere = baseKeys.slice(b, next);
    const mineHere = mineKeys.slice(m, mineEnd);
    const theirsHere = theirKeys.slice(t, theirEnd);
    if (same(mineHere, baseKeysHere))
      push({ kind: "merged", blocks: theirs.slice(t, theirEnd) });
    else if (same(theirsHere, baseKeysHere) || same(mineHere, theirsHere))
      push({ kind: "merged", blocks: mine.slice(m, mineEnd) });
    // Both only added blocks at the same place: nothing is replaced, so
    // both stay, theirs first (they are already in the draft).
    else if (!baseKeysHere.length)
      push({
        kind: "merged",
        blocks: [...theirs.slice(t, theirEnd), ...mine.slice(m, mineEnd)],
      });
    else
      push({
        kind: "conflict",
        base: base.slice(b, next),
        mine: mine.slice(m, mineEnd),
        theirs: theirs.slice(t, theirEnd),
      });
    if (next >= base.length) break;
    push({ kind: "stable", blocks: [theirs[theirEnd]!] });
    b = next + 1;
    m = mineEnd + 1;
    t = theirEnd + 1;
  }
  return chunks;
}

/** The merged blocks, with each conflict resolved to one side. */
export function resolveMerge<T>(
  chunks: readonly MergeChunk<T>[],
  side: "mine" | "theirs",
): T[] {
  return chunks.flatMap((c) =>
    c.kind === "conflict" ? (side === "mine" ? c.mine : c.theirs) : c.blocks,
  );
}

export const hasConflicts = (chunks: readonly MergeChunk<unknown>[]) =>
  chunks.some((c) => c.kind === "conflict");
