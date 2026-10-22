// Line diff of specification text, shared by the domain and the UI.
export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

// Line-based LCS diff. Specifications are short documents; O(n·m) on lines is
// fine and produces stable, readable results without a dependency. Common
// leading and trailing lines are matched first, so a local edit to a long
// document only compares the region that changed.
export function diffLines(before: string, after: string): DiffLine[] {
  const key = `${before.length}:${before}\u0000${after}`;
  const cached = diffCache.get(key);
  if (cached) {
    diffCache.delete(key);
    diffCache.set(key, cached);
    return cached;
  }
  const result = computeDiff(before, after);
  diffCache.set(key, result);
  if (diffCache.size > DIFF_CACHE_SIZE)
    diffCache.delete(diffCache.keys().next().value!);
  return result;
}
// Revisions and drafts are re-rendered often; their diffs rarely change.
const DIFF_CACHE_SIZE = 64;
const diffCache = new Map<string, DiffLine[]>();
function computeDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n?/g, "\n").split("\n");
  const b = after.replace(/\r\n?/g, "\n").split("\n");
  if (a.length === 1 && a[0] === "") a.length = 0;
  if (b.length === 1 && b[0] === "") b.length = 0;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = [];
  for (let k = 0; k < start; k++) out.push({ kind: "same", text: a[k]! });
  const n = endA - start;
  const m = endB - start;
  const table: Uint16Array[] = Array.from(
    { length: n + 1 },
    () => new Uint16Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i]![j] =
        a[start + i] === b[start + j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      out.push({ kind: "same", text: a[start + i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!)
      out.push({ kind: "removed", text: a[start + i++]! });
    else out.push({ kind: "added", text: b[start + j++]! });
  }
  while (i < n) out.push({ kind: "removed", text: a[start + i++]! });
  while (j < m) out.push({ kind: "added", text: b[start + j++]! });
  for (let k = endA; k < a.length; k++) out.push({ kind: "same", text: a[k]! });
  return out;
}

export function diffStats(before: string, after: string) {
  const lines = diffLines(before, after);
  return {
    added: lines.filter((l) => l.kind === "added").length,
    removed: lines.filter((l) => l.kind === "removed").length,
  };
}
