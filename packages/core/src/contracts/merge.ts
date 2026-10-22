// Three-way line merging, shared by server validation and the conflict editor.
// Bound the diff matrix; unusually large rewrites become explicit conflicts.
export type Snapshot = { title: string; content: string };
export type MergeChunk =
  { lines: string[] } | { base: string[]; ours: string[]; theirs: string[] };
type Edit = { start: number; end: number; lines: string[] };
function edits(base: string[], next: string[]): Edit[] | null {
  if (base.length * next.length > 1_000_000) return null;
  const matrix = Array.from(
    { length: base.length + 1 },
    () => new Uint32Array(next.length + 1),
  );
  for (let i = base.length - 1; i >= 0; i--)
    for (let j = next.length - 1; j >= 0; j--)
      matrix[i]![j] =
        base[i] === next[j]
          ? matrix[i + 1]![j + 1]! + 1
          : Math.max(matrix[i + 1]![j]!, matrix[i]![j + 1]!);
  const result: Edit[] = [];
  let i = 0,
    j = 0;
  while (i < base.length || j < next.length) {
    if (i < base.length && j < next.length && base[i] === next[j]) {
      i++;
      j++;
      continue;
    }
    const start = i,
      lines: string[] = [];
    while (i < base.length || j < next.length) {
      if (i < base.length && j < next.length && base[i] === next[j]) break;
      if (
        j < next.length &&
        (i === base.length || matrix[i]![j + 1]! > matrix[i + 1]![j]!)
      )
        lines.push(next[j++]!);
      else i++;
    }
    result.push({ start, end: i, lines });
  }
  return result;
}
function overlaps(a: Edit, b: Edit) {
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  if (a.start === a.end) return a.start > b.start && a.start < b.end;
  if (b.start === b.end) return b.start > a.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}
export function mergeText(
  base: string,
  ours: string,
  theirs: string,
): MergeChunk[] {
  if (ours === theirs || theirs === base) return [{ lines: ours.split("\n") }];
  if (ours === base) return [{ lines: theirs.split("\n") }];
  const a = base.split("\n"),
    own = edits(a, ours.split("\n")),
    other = edits(a, theirs.split("\n"));
  if (!own || !other)
    return [
      {
        base: base.split("\n"),
        ours: ours.split("\n"),
        theirs: theirs.split("\n"),
      },
    ];
  const pending = [
    ...own.map((e) => ({ ...e, side: "ours" })),
    ...other.map((e) => ({ ...e, side: "theirs" })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: MergeChunk[] = [];
  let cursor = 0;
  // Chunks contain line sequences; join once to preserve trailing newlines.
  while (pending.length) {
    const group = [pending.shift()!];
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < pending.length; i++)
        if (group.some((e) => overlaps(e, pending[i]!))) {
          group.push(pending.splice(i--, 1)[0]!);
          changed = true;
        }
    }
    const start = Math.min(...group.map((e) => e.start)),
      end = Math.max(...group.map((e) => e.end));
    if (start > cursor) out.push({ lines: a.slice(cursor, start) });
    const apply = (side: string) => {
      const lines: string[] = [];
      let p = start;
      for (const e of group
        .filter((e) => e.side === side)
        .sort((a, b) => a.start - b.start)) {
        lines.push(...a.slice(p, e.start), ...e.lines);
        p = e.end;
      }
      lines.push(...a.slice(p, end));
      return lines;
    };
    if (group.every((e) => e.side === group[0]!.side)) {
      out.push({ lines: apply(group[0]!.side) });
    } else {
      const o = apply("ours"),
        t = apply("theirs");
      out.push(
        JSON.stringify(o) === JSON.stringify(t)
          ? { lines: o }
          : { base: a.slice(start, end), ours: o, theirs: t },
      );
    }
    cursor = end;
  }
  if (cursor < a.length) out.push({ lines: a.slice(cursor) });
  return out;
}
export function mergeSnapshot(
  base: Snapshot,
  ours: Snapshot,
  theirs: Snapshot,
) {
  const titleConflict =
    ours.title !== theirs.title &&
    ours.title !== base.title &&
    theirs.title !== base.title;
  const title = ours.title === base.title ? theirs.title : ours.title;
  const chunks = mergeText(base.content, ours.content, theirs.content);
  return {
    title,
    chunks,
    conflicted: titleConflict || chunks.some((c) => !("lines" in c)),
    titleConflict,
    content: chunks
      .flatMap((c) => ("lines" in c ? c.lines : c.ours))
      .join("\n"),
  };
}
export function mergeBase<T extends { id: string; parentIds: string[] }>(
  commits: T[],
  ours: string,
  theirs: string,
): T | undefined {
  const map = new Map(commits.map((c) => [c.id, c]));
  const ancestors = (head: string) => {
    const distance = new Map<string, number>(),
      queue: [string, number][] = [[head, 0]];
    for (const [id, d] of queue) {
      if (distance.has(id)) continue;
      distance.set(id, d);
      for (const parent of map.get(id)?.parentIds ?? [])
        queue.push([parent, d + 1]);
    }
    return distance;
  };
  const a = ancestors(ours),
    b = ancestors(theirs);
  // Prefer a common ancestor that is not an ancestor of another common candidate.
  const common = commits.filter((c) => a.has(c.id) && b.has(c.id));
  // The common-ancestor set is closed over parents. A candidate with a
  // common child is older than another candidate and cannot be a merge base.
  const older = new Set(common.flatMap((c) => c.parentIds));
  const best = common.filter((c) => !older.has(c.id));
  // Criss-cross histories with multiple merge bases require a deliberate resolution.
  return best.length === 1 ? best[0] : undefined;
}
