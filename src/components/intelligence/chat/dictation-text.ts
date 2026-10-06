// Pure text bookkeeping for live dictation into a textarea.
//
// Dictated text lives in a tracked range of the draft. The range starts at the
// caret where dictation began and moves with edits the person makes before it,
// so they can keep typing elsewhere while the transcript keeps flowing into
// the original spot. While nobody has touched the range ("pristine"), the
// whole range is rewritten from the transcript, which lets the final
// transcript correct earlier partial words. Once someone edits inside it,
// their text wins: new words are only appended and the final pass is skipped.

export type Range = { start: number; end: number };

export type Dictation = {
  range: Range;
  // Transcript written so far, as received from the provider.
  spoken: string;
  pristine: boolean;
};

export type Change = { at: number; removed: number; inserted: number };

export function begin(caret: number): Dictation {
  return { range: { start: caret, end: caret }, spoken: "", pristine: true };
}

// The single contiguous change that turns `prev` into `next`.
export function diff(prev: string, next: string): Change {
  const max = Math.min(prev.length, next.length);
  let p = 0;
  while (p < max && prev[p] === next[p]) p++;
  let s = 0;
  while (s < max - p && prev[prev.length - 1 - s] === next[next.length - 1 - s])
    s++;
  return {
    at: p,
    removed: prev.length - p - s,
    inserted: next.length - p - s,
  };
}

// Keeps the dictation range in place across an edit made by the person.
// Text typed exactly at the range start pushes the range right; text typed
// exactly at its end stays outside it, so new words land before it.
export function applyEdit(d: Dictation, c: Change): Dictation {
  const { start, end } = d.range;
  const shift = c.inserted - c.removed;
  const after = c.at + c.removed;
  const newStart = start < c.at ? start : start >= after ? start + shift : c.at;
  let newEnd =
    end <= c.at ? end : end >= after ? end + shift : c.at + c.inserted;
  if (newEnd < newStart) newEnd = newStart;
  const touched = (c.at < end && after > start) || (c.at > start && c.at < end);
  return {
    ...d,
    range: { start: newStart, end: newEnd },
    pristine: d.pristine && !touched,
  };
}

// Where a caret/selection boundary lands after we rewrite the range. A caret
// sitting at the end of the dictated text follows it as it grows.
export function mapCaret(pos: number, c: Change): number {
  const after = c.at + c.removed;
  if (pos < c.at) return pos;
  if (pos === after) return c.at + c.inserted;
  if (pos === c.at) return pos;
  if (pos > after) return pos + c.inserted - c.removed;
  return c.at + c.inserted;
}

const space = /\s/;
const closing = /^[.,!?;:)\]}'"’”]/;

function shape(
  spoken: string,
  before: string | undefined,
  after: string | undefined,
  final: boolean,
) {
  let text = spoken.replace(/^\s+/, "");
  if (final) text = text.replace(/\s+$/, "");
  if (!text) return "";
  if (before !== undefined && !space.test(before) && !closing.test(text))
    text = ` ${text}`;
  if (
    final &&
    after !== undefined &&
    !space.test(after) &&
    !closing.test(after)
  )
    text = `${text} `;
  return text;
}

// Writes the transcript so far into `value`. Returns the new draft, the new
// dictation state and the change applied (for caret mapping), or null when
// nothing changes.
export function write(
  value: string,
  d: Dictation,
  spoken: string,
  final: boolean,
): { value: string; dictation: Dictation; change: Change } | null {
  const { start, end } = d.range;
  if (d.pristine) {
    const text = shape(spoken, value[start - 1], value[end], final);
    if (text === value.slice(start, end)) return null;
    return {
      value: value.slice(0, start) + text + value.slice(end),
      dictation: {
        range: { start, end: start + text.length },
        spoken,
        pristine: true,
      },
      change: { at: start, removed: end - start, inserted: text.length },
    };
  }
  // The person edited the dictated words: only append what is new, never
  // rewrite what they changed.
  if (!spoken.startsWith(d.spoken)) return null;
  const delta = spoken.slice(d.spoken.length);
  if (!delta) return null;
  return {
    value: value.slice(0, end) + delta + value.slice(end),
    dictation: {
      range: { start, end: end + delta.length },
      spoken,
      pristine: false,
    },
    change: { at: end, removed: 0, inserted: delta.length },
  };
}

// Removes untouched dictated text (cancel). Edited text is kept.
export function discard(
  value: string,
  d: Dictation,
): { value: string; change: Change } | null {
  const { start, end } = d.range;
  if (!d.pristine || start === end) return null;
  return {
    value: value.slice(0, start) + value.slice(end),
    change: { at: start, removed: end - start, inserted: 0 },
  };
}
