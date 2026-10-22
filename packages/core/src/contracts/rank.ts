// Fractional ranks: base-36 strings compared lexicographically. A move writes
// one row by choosing a rank strictly between its new neighbours.
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

export function rankBetween(before: string | null, after: string | null) {
  const a = before ?? "";
  let b = after;
  if (b !== null && a >= b) throw new Error("Ranks must be ordered.");
  let result = "";
  for (let i = 0; ; i++) {
    const da = i < a.length ? DIGITS.indexOf(a[i]!) : 0;
    const db = b !== null && i < b.length ? DIGITS.indexOf(b[i]!) : BASE;
    if (da === db) {
      result += DIGITS[da];
      continue;
    }
    const mid = Math.floor((da + db) / 2);
    if (mid > da) return result + DIGITS[mid];
    // Adjacent digits: keep a's digit and search the next position with no
    // upper bound, since any suffix now sorts below b.
    result += DIGITS[da];
    b = null;
  }
}

// Evenly spaced ranks for seeding or rebalancing `count` items.
export function initialRanks(count: number, after: string | null = null) {
  const ranks: string[] = [];
  let last = after;
  for (let i = 0; i < count; i++) {
    last = rankBetween(last, null);
    ranks.push(last);
  }
  return ranks;
}
