// Changed words between two texts, shared by page and specification diffs.
export type TextRange = { from: number; to: number };

// Token offsets preserve punctuation, whitespace and Unicode. Trim common ends
// before LCS and cap its matrix so a very large replacement stays responsive.
export function changedWords(
  before: string,
  after: string,
): {
  before: TextRange[];
  after: TextRange[];
} {
  const tokens = (text: string) =>
    text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
  const a = tokens(before),
    b = tokens(after);
  let start = 0,
    endA = a.length,
    endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const sameA = new Set<number>(),
    sameB = new Set<number>();
  if ((endA - start) * (endB - start) <= 250_000) {
    const width = endB - start + 1;
    const matrix = new Uint32Array((endA - start + 1) * width);
    for (let i = endA - 1; i >= start; i--)
      for (let j = endB - 1; j >= start; j--) {
        const at = (i - start) * width + j - start;
        matrix[at] =
          a[i] === b[j]
            ? 1 + matrix[at + width + 1]!
            : Math.max(matrix[at + width]!, matrix[at + 1]!);
      }
    let i = start,
      j = start;
    while (i < endA && j < endB) {
      if (a[i] === b[j]) {
        sameA.add(i++);
        sameB.add(j++);
      } else if (
        matrix[(i - start + 1) * width + j - start]! >=
        matrix[(i - start) * width + j - start + 1]!
      )
        i++;
      else j++;
    }
  }
  const ranges = (list: string[], end: number, same: Set<number>) => {
    const result: TextRange[] = [];
    let offset = 0;
    list.forEach((token, index) => {
      if (index >= start && index < end && !same.has(index)) {
        const last = result.at(-1);
        if (last?.to === offset) last.to += token.length;
        else result.push({ from: offset, to: offset + token.length });
      }
      offset += token.length;
    });
    return result;
  };
  return {
    before: tidy(before, ranges(a, endA, sameA)),
    after: tidy(after, ranges(b, endB, sameB)),
  };
}

// Marks read as words: changes separated only by spaces become one mark
// ("up" and "to four" read "up to four"), and no mark starts or ends with
// whitespace.
function tidy(text: string, list: TextRange[]): TextRange[] {
  const merged: TextRange[] = [];
  for (const range of list) {
    const last = merged.at(-1);
    if (last && /^[ \t]*$/.test(text.slice(last.to, range.from)))
      last.to = range.to;
    else merged.push({ ...range });
  }
  return merged.flatMap((range) => {
    let { from, to } = range;
    while (from < to && /\s/.test(text[from]!)) from++;
    while (to > from && /\s/.test(text[to - 1]!)) to--;
    return from < to ? [{ from, to }] : [];
  });
}
